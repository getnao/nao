import puppeteer, { type Browser } from 'puppeteer';

import type { QueryDataMap, StoryInput } from './story-download';
import { generateStoryHtml } from './story-html';

let browserPromise: Promise<Browser> | null = null;

export async function generateStoryPdf(story: StoryInput, queryData: QueryDataMap | null): Promise<Buffer> {
	const html = generateStoryHtml(story, queryData);
	const browser = await getBrowser();
	const page = await browser.newPage();

	try {
		await page.setContent(html, { waitUntil: 'domcontentloaded' });
		const pdfBuffer = await page.pdf({
			format: 'A4',
			printBackground: true,
			margin: { top: '40px', bottom: '40px', left: '40px', right: '40px' },
		});
		return Buffer.from(pdfBuffer);
	} finally {
		await page.close();
	}
}

async function getBrowser(): Promise<Browser> {
	if (browserPromise) {
		const browser = await browserPromise;
		if (browser.connected) {
			return browser;
		}
		await browser.close().catch(() => {});
	}
	browserPromise = puppeteer.launch({
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
	});
	return browserPromise;
}

async function closeBrowser() {
	if (!browserPromise) {
		return;
	}
	const browser = await browserPromise.catch(() => null);
	browserPromise = null;
	await browser?.close().catch(() => {});
}

for (const signal of ['SIGINT', 'SIGTERM', 'exit'] as const) {
	process.on(signal, () => void closeBrowser());
}
