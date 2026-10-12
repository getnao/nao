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
		const screenshot = await renderStoryScreenshot(readyPage('<p>content</p>'), VIEWPORT);

		const metadata = await sharp(screenshot.image).metadata();
		expect(metadata).toMatchObject({ format: 'png', width: 1280, height: 800 });
		expect(isBrokenRender(screenshot)).toBe(false);
	});

	it('is broken on runtime errors, including the ones the error boundary catches', async () => {
		const screenshot = await renderStoryScreenshot(
			readyPage(
				'<p>content</p>',
				`window.postMessage({ type: 'nao-story:error', message: 'boundary error' }, '*');
				setTimeout(() => { throw new Error('thrown error'); });`,
			),
			VIEWPORT,
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
		);

		expect(screenshot.blockErrors).toEqual(['Query q1 is not part of this export.']);
		expect(isBrokenRender(screenshot)).toBe(true);
	});

	it('is broken on a blank page', async () => {
		const screenshot = await renderStoryScreenshot(readyPage(''), VIEWPORT);

		expect(screenshot.blank).toBe(true);
		expect(isBrokenRender(screenshot)).toBe(true);
	});

	it('is broken when the app never finishes mounting', { timeout: 60_000 }, async () => {
		const screenshot = await renderStoryScreenshot('<html><body><p>loading</p></body></html>', VIEWPORT);

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
