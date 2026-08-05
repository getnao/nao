import type { DateFormatSettings } from '@nao/shared/date';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import type { Browser } from 'puppeteer-core';

import type { QueryDataMap, StoryInput } from './story-download';
import { generateStoryHtml } from './story-html';

let browserPromise: Promise<Browser> | null = null;

const A4_PRINTABLE_WIDTH_PX = 714;
const A4_PRINTABLE_HEIGHT_PX = 1043;

async function loadPuppeteer() {
	try {
		return await import('puppeteer-core');
	} catch {
		throw new Error(
			'puppeteer-core is not available. PDF export requires puppeteer-core and a Chrome/Chromium installation.',
		);
	}
}

export async function generateStoryPdf(
	story: StoryInput,
	queryData: QueryDataMap | null,
	dateFormat?: DateFormatSettings | null,
): Promise<Buffer> {
	const html = await generateStoryHtml(story, queryData, dateFormat);
	const hasMaps = html.includes('class="nao-map"');
	const browser = await getBrowser();
	const page = await browser.newPage();

	try {
		if (hasMaps) {
			await page.emulateMediaType('print');
			await page.setViewport({
				width: A4_PRINTABLE_WIDTH_PX,
				height: A4_PRINTABLE_HEIGHT_PX,
				deviceScaleFactor: 2,
			});
		}
		await page
			.setContent(html, { waitUntil: hasMaps ? 'load' : 'domcontentloaded', timeout: 30000 })
			.catch(() => {});
		if (hasMaps) {
			await page.waitForFunction('window.__naoMapsReady === true', { timeout: 15000 }).catch(() => {});
		}
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
	browserPromise = puppeteer.default
		.launch({
			headless: true,
			executablePath: findChromePath(),
			args: [
				'--no-sandbox',
				'--disable-setuid-sandbox',
				'--disable-gpu',
				'--disable-dev-shm-usage',
				'--enable-unsafe-swiftshader',
			],
		})
		.catch((error) => {
			browserPromise = null;
			throw error;
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
