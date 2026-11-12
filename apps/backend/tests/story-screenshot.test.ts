import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';

import { closeBrowser } from '../src/utils/headless-browser';
import { isBrokenRender, renderStoryScreenshot } from '../src/utils/story-screenshot';

const VIEWPORT = { width: 1280, height: 800 };

const isChromeAvailable = await import('../src/utils/headless-browser')
	.then(({ getBrowser }) => getBrowser())
	.then(
		() => true,
		() => false,
	);

describe.skipIf(!isChromeAvailable)('rendering a story screenshot', () => {
	afterAll(async () => {
		await closeBrowser();
	});

	it('captures the first screen of a story that rendered cleanly', async () => {
		const screenshot = await renderStoryScreenshot(readyPage('<p>content</p>'), VIEWPORT, []);

		const metadata = await sharp(screenshot.image).metadata();
		expect(metadata).toMatchObject({ format: 'png', width: 1280, height: 800 });
		expect(isBrokenRender(screenshot)).toBe(false);
	});

	it('redacts query-backed block bodies without changing their headers', async () => {
		const screenshot = await renderStoryScreenshot(
			readyPage(`
				<section data-nao-block-query="orders" style="width: 400px">
					<header style="height: 80px; background: #ef4444">Orders</header>
					<div class="nao-block__body" style="height: 200px; background: repeating-linear-gradient(90deg, #000 0 8px, #fff 8px 16px)">
						PRIVATE DATA 12345
					</div>
				</section>
			`),
			VIEWPORT,
			[],
			{ redactData: true },
		);

		const originalHeader = await imageRegion(screenshot.image, 0, 0, 400, 80);
		const redactedHeader = await imageRegion(screenshot.redactedImage!, 0, 0, 400, 80);
		const originalBody = await imageRegion(screenshot.image, 0, 80, 400, 200);
		const redactedBody = await imageRegion(screenshot.redactedImage!, 0, 80, 400, 200);

		expect(redactedHeader.equals(originalHeader)).toBe(true);
		expect(redactedBody.equals(originalBody)).toBe(false);
	});

	it('is broken on runtime errors, including the ones the error boundary catches', async () => {
		const screenshot = await renderStoryScreenshot(
			readyPage(
				'<p>content</p>',
				`window.postMessage({ type: 'nao-story:error', message: 'boundary error' }, '*');
				setTimeout(() => { throw new Error('thrown error'); });`,
			),
			VIEWPORT,
			[],
		);

		expect(screenshot.runtimeErrors).toEqual(expect.arrayContaining(['boundary error', 'thrown error']));
		expect(isBrokenRender(screenshot)).toBe(true);
	});

	it('is broken when story-kit blocks show an error', async () => {
		const screenshot = await renderStoryScreenshot(
			readyPage(`
				<div class="nao-block__state nao-block__state--error">Query q1 is not part of this export.</div>
				<div class="nao-block__state">No rows.</div>
			`),
			VIEWPORT,
			[],
		);

		expect(screenshot.blockErrors).toEqual(['Query q1 is not part of this export.']);
		expect(isBrokenRender(screenshot)).toBe(true);
	});

	it('is broken on a blank page', async () => {
		const screenshot = await renderStoryScreenshot(readyPage(''), VIEWPORT, []);

		expect(screenshot.blank).toBe(true);
		expect(isBrokenRender(screenshot)).toBe(true);
	});

	it('is blank when its only content sits below the captured first screen', async () => {
		const screenshot = await renderStoryScreenshot(
			readyPage(`<div style="margin-top: ${VIEWPORT.height * 2}px">Below the fold</div>`),
			VIEWPORT,
			[],
		);

		expect(screenshot.blank).toBe(true);
	});

	it('keeps a story drawn only with CSS shapes', async () => {
		const screenshot = await renderStoryScreenshot(
			readyPage('<div style="width: 200px; height: 120px; background: #c2410c"></div>'),
			VIEWPORT,
			[],
		);

		expect(screenshot.blank).toBe(false);
	});

	it('ignores block errors outside the captured first screen', async () => {
		const screenshot = await renderStoryScreenshot(
			readyPage(
				`<p>content</p><div class="nao-block__state--error" style="margin-top: ${VIEWPORT.height * 2}px">Hidden error</div>`,
			),
			VIEWPORT,
			[],
		);

		expect(screenshot.blockErrors).toEqual([]);
	});

	it('is broken when the app never finishes mounting', { timeout: 60_000 }, async () => {
		const screenshot = await renderStoryScreenshot('<html><body><p>loading</p></body></html>', VIEWPORT, []);

		expect(screenshot.ready).toBe(false);
		expect(isBrokenRender(screenshot)).toBe(true);
	});
});

function readyPage(body: string, script = ''): string {
	return `<html><body style="margin: 0">${body}<script>
		document.documentElement.dataset.naoStoryReady = 'true';
		${script}
	</script></body></html>`;
}

function imageRegion(image: Buffer, left: number, top: number, width: number, height: number): Promise<Buffer> {
	return sharp(image).extract({ left, top, width, height }).raw().toBuffer();
}
