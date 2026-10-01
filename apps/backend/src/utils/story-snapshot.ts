import { STORY_PRINT_FLAG, STORY_PRINT_SLIDES_ATTRIBUTE, STORY_SLIDE_SIZE } from '@nao/shared/story-app';
import { isStoryMapTileHost, storyMapTileCspSources } from '@nao/shared/story-map-tiles';
import { FONT_STYLESHEET_HOSTS } from '@nao/shared/story-theme';
import type { DownloadFormat } from '@nao/shared/types';
import type { HTTPRequest, Page, PDFOptions } from 'puppeteer-core';

import { getBrowser } from './headless-browser';
import { formatDownloadFilename } from './story-download';
import { expandStoryViews } from './story-print-views';

export const MAX_STORY_SNAPSHOT_BYTES = 24 * 1024 * 1024;

const DOCUMENT_URL = 'https://story-export.nao.invalid/';
const LAYOUT_WIDTH_PX = 1100;
const A4_SHORT_SIDE_PX = 794;
const A4_LONG_SIDE_PX = 1123;
const PAGE_MARGIN_PX = 36;
const READY_TIMEOUT_MS = 20_000;
const RENDER_SETTLE_MS = 1_800;
const VIEW_SETTLE_MS = 1_600;
const ALLOWED_REQUEST_HOSTS = new Set<string>(FONT_STYLESHEET_HOSTS);
const FONT_HOST_SOURCES = FONT_STYLESHEET_HOSTS.map((host) => `https://${host}`).join(' ');
const TILE_HOST_SOURCES = storyMapTileCspSources().join(' ');

/**
 * The exported page runs the story's own code (agent-written, so untrusted): the policy comes from a response header
 * the page cannot drop, and every request but the document, theme fonts and map tiles is aborted.
 */
const EXPORT_CONTENT_SECURITY_POLICY = [
	`default-src 'none'`,
	`script-src 'unsafe-inline' blob:`,
	`style-src 'unsafe-inline' ${FONT_HOST_SOURCES}`,
	`font-src data: ${FONT_HOST_SOURCES}`,
	`img-src data: blob: ${TILE_HOST_SOURCES}`,
	`connect-src 'none'`,
	`frame-src 'none'`,
	`worker-src 'none'`,
	`base-uri 'none'`,
	`form-action 'none'`,
].join('; ');

/** Custom stories download as a self-contained page; the PDF is that page printed once the story has rendered. */
export async function buildStorySnapshotDownload(
	format: DownloadFormat,
	title: string,
	html: string,
): Promise<{ data: string; filename: string; mimeType: string }> {
	const buffer = format === 'pdf' ? await renderStoryPdf(html) : Buffer.from(html);
	return {
		data: buffer.toString('base64'),
		filename: formatDownloadFilename(title, format),
		mimeType: format === 'pdf' ? 'application/pdf' : 'text/html',
	};
}

export async function renderStoryPdf(html: string): Promise<Buffer> {
	const browser = await getBrowser();
	const page = await browser.newPage();
	try {
		await isolatePage(page, html);
		await page.setViewport({ width: LAYOUT_WIDTH_PX, height: 900, deviceScaleFactor: 2 });
		await page.goto(DOCUMENT_URL, { waitUntil: 'load', timeout: 30_000 }).catch(() => {});
		await page
			.waitForFunction(() => document.documentElement.dataset.naoStoryReady === 'true', {
				timeout: READY_TIMEOUT_MS,
			})
			.catch(() => {});
		const pdf = await page.pdf(await layOutForPrint(page));
		return Buffer.from(pdf);
	} finally {
		await page.close();
	}
}

/** A kit deck prints one slide per 16:9 page; any other story is walked through its own tabs or slides first. */
async function layOutForPrint(page: Page): Promise<PDFOptions> {
	await delay(RENDER_SETTLE_MS);
	const isKitDeck = await page.evaluate(
		(attribute) => document.documentElement.hasAttribute(attribute),
		STORY_PRINT_SLIDES_ATTRIBUTE,
	);
	if (isKitDeck) {
		await page.setViewport({ ...STORY_SLIDE_SIZE, deviceScaleFactor: 2 });
		await delay(RENDER_SETTLE_MS);
		return deckPdfOptions();
	}
	const layout = await expandStoryViews(page, {
		settleMs: VIEW_SETTLE_MS,
		slidePageHeightPx: printableLayoutHeight(true),
	}).catch(() => 'single' as const);
	return a4PdfOptions(layout === 'slides');
}

async function isolatePage(page: Page, html: string): Promise<void> {
	await page.emulateMediaType('screen');
	await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
	await page.evaluateOnNewDocument((flag) => {
		Object.assign(globalThis, { [flag]: true });
	}, STORY_PRINT_FLAG);
	await page.setRequestInterception(true);
	page.on('request', (request) => void answerRequest(request, html));
}

async function answerRequest(request: HTTPRequest, html: string): Promise<void> {
	if (request.url() === DOCUMENT_URL) {
		await request.respond({
			status: 200,
			contentType: 'text/html; charset=utf-8',
			headers: { 'Content-Security-Policy': EXPORT_CONTENT_SECURITY_POLICY },
			body: html,
		});
		return;
	}
	await (isAllowedRequest(request) ? request.continue() : request.abort());
}

/** Stories lay out at a desktop width, then scale down to fit A4: the print matches what charts measured on screen. */
function a4PdfOptions(landscape: boolean): PDFOptions {
	return {
		format: 'A4',
		landscape,
		printBackground: true,
		scale: printScale(landscape),
		margin: {
			top: `${PAGE_MARGIN_PX}px`,
			bottom: `${PAGE_MARGIN_PX}px`,
			left: `${PAGE_MARGIN_PX}px`,
			right: `${PAGE_MARGIN_PX}px`,
		},
	};
}

function printScale(landscape: boolean): number {
	const paperWidth = landscape ? A4_LONG_SIDE_PX : A4_SHORT_SIDE_PX;
	return (paperWidth - 2 * PAGE_MARGIN_PX) / LAYOUT_WIDTH_PX;
}

function printableLayoutHeight(landscape: boolean): number {
	const paperHeight = landscape ? A4_SHORT_SIDE_PX : A4_LONG_SIDE_PX;
	return (paperHeight - 2 * PAGE_MARGIN_PX) / printScale(landscape);
}

function deckPdfOptions(): PDFOptions {
	return {
		width: `${STORY_SLIDE_SIZE.width}px`,
		height: `${STORY_SLIDE_SIZE.height}px`,
		printBackground: true,
		margin: { top: '0', bottom: '0', left: '0', right: '0' },
	};
}

function isAllowedRequest(request: HTTPRequest): boolean {
	const url = request.url();
	if (url.startsWith('data:') || url.startsWith('blob:')) {
		return true;
	}
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== 'https:') {
			return false;
		}
		return ALLOWED_REQUEST_HOSTS.has(parsed.hostname) || isStoryMapTileHost(parsed.hostname);
	} catch {
		return false;
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
