import { execSync } from 'child_process';
import { existsSync } from 'fs';
import type { Browser } from 'puppeteer-core';

import type { QueryDataMap, StoryInput } from './story-download';
import { generateStoryHtml } from './story-html';

let browserPromise: Promise<Browser> | null = null;

async function loadPuppeteer() {
	try {
		return await import('puppeteer-core');
	} catch {
		throw new Error(
			'puppeteer-core is not available. PDF export requires puppeteer-core and a Chrome/Chromium installation.',
		);
	}
}

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
	const puppeteer = await loadPuppeteer();
	browserPromise = puppeteer.default.launch({
		headless: true,
		executablePath: findChromePath(),
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
	});
	return browserPromise;
}

function findChromePath(): string {
	const candidates = [
		process.env.CHROME_PATH,
		'/usr/bin/chromium',
		'/usr/bin/chromium-browser',
		'/usr/bin/google-chrome',
	];

	for (const candidate of candidates) {
		if (candidate && existsSync(candidate)) {
			return candidate;
		}
	}

	try {
		return execSync('which chromium || which chromium-browser || which google-chrome', {
			encoding: 'utf-8',
		}).trim();
	} catch {
		throw new Error('Chrome/Chromium not found. Install chromium or set the CHROME_PATH environment variable.');
	}
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
