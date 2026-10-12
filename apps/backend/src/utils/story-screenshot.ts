import type { Page } from 'puppeteer-core';

import { getBrowser } from './headless-browser';
import { delay, isolateStoryPage, STORY_DOCUMENT_URL, waitForStoryReady } from './story-headless-page';

const RENDER_SETTLE_MS = 1_800;
const MAX_REPORTED_ERRORS = 5;
const BLOCK_ERROR_SELECTOR = '.nao-block__state--error';
const STORY_ERRORS_GLOBAL = '__naoStoryErrors';

export interface StoryScreenshot {
	ready: boolean;
	blank: boolean;
	runtimeErrors: string[];
	blockErrors: string[];
	image: Buffer;
}

interface PageContent {
	blank: boolean;
	blockErrors: string[];
	storyErrors: string[];
}

/** Renders a self-contained story document and captures its first screen, with what went wrong while it rendered. */
export async function renderStoryScreenshot(
	html: string,
	viewport: { width: number; height: number },
): Promise<StoryScreenshot> {
	const browser = await getBrowser();
	const page = await browser.newPage();
	const pageErrors = collectPageErrors(page);
	try {
		await isolateStoryPage(page, html, { print: false });
		await page.evaluateOnNewDocument(listenToStoryErrors, STORY_ERRORS_GLOBAL);
		await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
		await page.goto(STORY_DOCUMENT_URL, { waitUntil: 'load', timeout: 30_000 }).catch(() => {});
		const ready = await waitForStoryReady(page);
		await delay(RENDER_SETTLE_MS);
		const content = await page.evaluate(inspectContent, {
			errorsGlobal: STORY_ERRORS_GLOBAL,
			blockErrorSelector: BLOCK_ERROR_SELECTOR,
		});
		return {
			ready,
			blank: content.blank,
			runtimeErrors: [...new Set([...pageErrors, ...content.storyErrors])].slice(0, MAX_REPORTED_ERRORS),
			blockErrors: content.blockErrors,
			image: Buffer.from(await page.screenshot({ type: 'png' })),
		};
	} finally {
		await page.close();
	}
}

/** A story that never mounted, threw at runtime, rendered nothing or shows block errors is not worth a thumbnail. */
export function isBrokenRender(screenshot: Omit<StoryScreenshot, 'image'>): boolean {
	return (
		!screenshot.ready ||
		screenshot.blank ||
		screenshot.runtimeErrors.length > 0 ||
		screenshot.blockErrors.length > 0
	);
}

function collectPageErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('pageerror', (error) => {
		errors.push(error instanceof Error ? error.message : String(error));
	});
	return errors;
}

/** The runtime posts errors caught by its React error boundary to its host; in a top-level page, that is itself. */
function listenToStoryErrors(errorsGlobal: string): void {
	const errors: string[] = [];
	Object.assign(globalThis, { [errorsGlobal]: errors });
	window.addEventListener('message', (event) => {
		const data = event.data as { type?: unknown; message?: unknown } | null;
		if (data?.type === 'nao-story:error' && typeof data.message === 'string') {
			errors.push(data.message);
		}
	});
}

/** Runs inside the page, serialized by puppeteer: it must stay self-contained, without named inner functions. */
function inspectContent({
	errorsGlobal,
	blockErrorSelector,
}: {
	errorsGlobal: string;
	blockErrorSelector: string;
}): PageContent {
	const blockErrors = Array.from(document.querySelectorAll<HTMLElement>(blockErrorSelector)).map((state) =>
		(state.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
	);
	const hasText = (document.body.innerText ?? '').trim().length > 0;
	const hasGraphics = document.body.querySelector('canvas, svg, img, video') !== null;
	return {
		blank: !hasText && !hasGraphics,
		blockErrors: [...new Set(blockErrors)],
		storyErrors: ((globalThis as Record<string, unknown>)[errorsGlobal] as string[] | undefined) ?? [],
	};
}
