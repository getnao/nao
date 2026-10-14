import { STORY_PRINT_FLAG } from '@nao/shared/story-app';
import { isStoryMapTileUrl, storyMapTileCspSources } from '@nao/shared/story-map-tiles';
import { DEFAULT_STORY_THEME_PAIR, FONT_STYLESHEET_HOSTS, type StoryThemePair } from '@nao/shared/story-theme';
import type { HTTPRequest, Page } from 'puppeteer-core';

export const STORY_DOCUMENT_URL = 'https://story-export.nao.invalid/';

const READY_TIMEOUT_MS = 20_000;
const FONT_HOSTS = new Set<string>(FONT_STYLESHEET_HOSTS);
const FONT_HOST_SOURCES = FONT_STYLESHEET_HOSTS.map((host) => `https://${host}`).join(' ');
const TILE_HOST_SOURCES = storyMapTileCspSources().join(' ');

/**
 * The page runs the story's own code (agent-written, so untrusted): the policy comes from a response header
 * the page cannot drop, and every request but the document, the theme's fonts and map tiles is aborted.
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
export async function isolateStoryPage(
	page: Page,
	html: string,
	options: { print: boolean; fontStylesheets: string[] },
): Promise<void> {
	await page.emulateMediaType('screen');
	await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
	if (options.print) {
		await page.evaluateOnNewDocument((flag) => {
			Object.assign(globalThis, { [flag]: true });
		}, STORY_PRINT_FLAG);
	}
	await page.setRequestInterception(true);
	const fontStylesheets = new Set(options.fontStylesheets);
	page.on('request', (request) => void answerRequest(request, html, fontStylesheets));
}

export function themeFontStylesheets(theme: StoryThemePair | null): string[] {
	const pair = theme ?? DEFAULT_STORY_THEME_PAIR;
	return [...new Set([...pair.light.text.fontStylesheets, ...pair.dark.text.fontStylesheets].map(normalizeUrl))];
}

function normalizeUrl(raw: string): string {
	try {
		return new URL(raw).href;
	} catch {
		return raw;
	}
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

async function answerRequest(request: HTTPRequest, html: string, fontStylesheets: Set<string>): Promise<void> {
	if (request.url() === STORY_DOCUMENT_URL) {
		await request.respond({
			status: 200,
			contentType: 'text/html; charset=utf-8',
			headers: { 'Content-Security-Policy': STORY_CONTENT_SECURITY_POLICY },
			body: html,
		});
		return;
	}
	await (isAllowedRequest(request, fontStylesheets) ? request.continue() : request.abort());
}

/** A story could encode its data in any URL it requests, so only the theme's stylesheets, fonts and tiles pass. */
function isAllowedRequest(request: HTTPRequest, fontStylesheets: Set<string>): boolean {
	const url = request.url();
	if (url.startsWith('data:') || url.startsWith('blob:')) {
		return true;
	}
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== 'https:') {
			return false;
		}
		if (fontStylesheets.has(url)) {
			return true;
		}
		if (request.resourceType() === 'font') {
			return FONT_HOSTS.has(parsed.hostname);
		}
		return request.resourceType() === 'image' && isStoryMapTileUrl(parsed);
	} catch {
		return false;
	}
}
