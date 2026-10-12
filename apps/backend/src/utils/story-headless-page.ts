import { STORY_PRINT_FLAG } from '@nao/shared/story-app';
import { isStoryMapTileHost, storyMapTileCspSources } from '@nao/shared/story-map-tiles';
import { FONT_STYLESHEET_HOSTS } from '@nao/shared/story-theme';
import type { HTTPRequest, Page } from 'puppeteer-core';

export const STORY_DOCUMENT_URL = 'https://story-export.nao.invalid/';

const READY_TIMEOUT_MS = 20_000;
const ALLOWED_REQUEST_HOSTS = new Set<string>(FONT_STYLESHEET_HOSTS);
const FONT_HOST_SOURCES = FONT_STYLESHEET_HOSTS.map((host) => `https://${host}`).join(' ');
const TILE_HOST_SOURCES = storyMapTileCspSources().join(' ');

/**
 * The page runs the story's own code (agent-written, so untrusted): the policy comes from a response header
 * the page cannot drop, and every request but the document, theme fonts and map tiles is aborted.
 */
const STORY_CONTENT_SECURITY_POLICY = [
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

/** Serves `html` as the only document the page can load, before `goto(STORY_DOCUMENT_URL)`. */
export async function isolateStoryPage(page: Page, html: string, options: { print: boolean }): Promise<void> {
	await page.emulateMediaType('screen');
	await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
	if (options.print) {
		await page.evaluateOnNewDocument((flag) => {
			Object.assign(globalThis, { [flag]: true });
		}, STORY_PRINT_FLAG);
	}
	await page.setRequestInterception(true);
	page.on('request', (request) => void answerRequest(request, html));
}

/** Resolves to whether the story runtime finished mounting the app in time. */
export async function waitForStoryReady(page: Page): Promise<boolean> {
	return page
		.waitForFunction(() => document.documentElement.dataset.naoStoryReady === 'true', {
			timeout: READY_TIMEOUT_MS,
		})
		.then(
			() => true,
			() => false,
		);
}

export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function answerRequest(request: HTTPRequest, html: string): Promise<void> {
	if (request.url() === STORY_DOCUMENT_URL) {
		await request.respond({
			status: 200,
			contentType: 'text/html; charset=utf-8',
			headers: { 'Content-Security-Policy': STORY_CONTENT_SECURITY_POLICY },
			body: html,
		});
		return;
	}
	await (isAllowedRequest(request) ? request.continue() : request.abort());
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
