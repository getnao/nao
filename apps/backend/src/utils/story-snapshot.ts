import { STORY_PRINT_CANVAS_ATTRIBUTE, STORY_PRINT_SLIDES_ATTRIBUTE, STORY_SLIDE_SIZE } from '@nao/shared/story-app';
import type { DownloadFormat } from '@nao/shared/types';
import type { Page, PDFOptions } from 'puppeteer-core';

import { getBrowser } from './headless-browser';
import { formatDownloadFilename } from './story-download';
import { delay, isolateStoryPage, STORY_DOCUMENT_URL, waitForStoryReady } from './story-headless-page';
import { expandStoryViews } from './story-print-views';

export const MAX_STORY_SNAPSHOT_BYTES = 24 * 1024 * 1024;

const LAYOUT_WIDTH_PX = 1100;
const A4_SHORT_SIDE_PX = 794;
const A4_LONG_SIDE_PX = 1123;
const PAGE_MARGIN_PX = 36;
const RENDER_SETTLE_MS = 1_800;
const VIEW_SETTLE_MS = 1_600;

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
		await isolateStoryPage(page, html, { print: true });
		await page.setViewport({ width: LAYOUT_WIDTH_PX, height: 900, deviceScaleFactor: 2 });
		await page.goto(STORY_DOCUMENT_URL, { waitUntil: 'load', timeout: 30_000 }).catch(() => {});
		await waitForStoryReady(page);
		const pdf = await page.pdf(await layOutForPrint(page));
		return Buffer.from(pdf);
	} finally {
		await page.close();
	}
}

/** Decks and canvases print on pages of their own size; other stories are walked through their tabs or slides. */
async function layOutForPrint(page: Page): Promise<PDFOptions> {
	await delay(RENDER_SETTLE_MS);
	const fixedPage = await readFixedPageSize(page);
	if (fixedPage) {
		await page.setViewport({ ...fixedPage, deviceScaleFactor: 2 });
		await delay(RENDER_SETTLE_MS);
		return fixedPagePdfOptions(fixedPage);
	}
	const layout = await expandStoryViews(page, {
		settleMs: VIEW_SETTLE_MS,
		slidePageHeightPx: printableLayoutHeight(true),
	}).catch(() => 'single' as const);
	return a4PdfOptions(layout === 'slides');
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

async function readFixedPageSize(page: Page): Promise<{ width: number; height: number } | null> {
	const { isDeck, canvas } = await page.evaluate(
		(slidesAttribute, canvasAttribute) => ({
			isDeck: document.documentElement.hasAttribute(slidesAttribute),
			canvas: document.documentElement.getAttribute(canvasAttribute),
		}),
		STORY_PRINT_SLIDES_ATTRIBUTE,
		STORY_PRINT_CANVAS_ATTRIBUTE,
	);
	if (isDeck) {
		return STORY_SLIDE_SIZE;
	}
	return canvas ? parseCanvasSize(canvas) : null;
}

function parseCanvasSize(value: string): { width: number; height: number } | null {
	const match = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(value);
	if (!match) {
		return null;
	}
	const size = { width: Math.round(Number(match[1])), height: Math.round(Number(match[2])) };
	return size.width > 0 && size.height > 0 ? size : null;
}

function fixedPagePdfOptions(size: { width: number; height: number }): PDFOptions {
	return {
		width: `${size.width}px`,
		height: `${size.height}px`,
		printBackground: true,
		margin: { top: '0', bottom: '0', left: '0', right: '0' },
	};
}
