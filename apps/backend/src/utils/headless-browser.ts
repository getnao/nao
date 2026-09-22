import { execSync } from 'child_process';
import { existsSync } from 'fs';
import type { Browser } from 'puppeteer-core';

let browserPromise: Promise<Browser> | null = null;
let activeBrowser: Browser | null = null;

async function loadPuppeteer() {
	try {
		return await import('puppeteer-core');
	} catch {
		throw new Error(
			'puppeteer-core is not available. Headless rendering requires puppeteer-core and a Chrome/Chromium installation.',
		);
	}
}

/** Shared, lazily-launched headless Chromium used for server-side rendering (PDF export, static map images). */
export async function getBrowser(): Promise<Browser> {
	if (browserPromise) {
		const browser = await browserPromise.catch(() => null);
		if (browser?.connected) {
			return browser;
		}
		await closeBrowser();
	}
	if (!browserPromise) {
		browserPromise = launchBrowser();
	}
	return browserPromise;
}

async function launchBrowser(): Promise<Browser> {
	try {
		const puppeteer = await loadPuppeteer();
		const browser = await puppeteer.default.launch({
			headless: true,
			executablePath: findChromePath(),
			args: browserLaunchArgs(),
		});
		activeBrowser = browser;
		browser.on('disconnected', () => {
			if (activeBrowser === browser) {
				activeBrowser = null;
			}
		});
		return browser;
	} catch (error) {
		browserPromise = null;
		throw error;
	}
}

function browserLaunchArgs(): string[] {
	const args = ['--disable-gpu', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'];
	if (isSandboxDisabled()) {
		args.unshift('--no-sandbox', '--disable-setuid-sandbox');
	}
	return args;
}

function isSandboxDisabled(): boolean {
	if (process.env.PUPPETEER_DISABLE_SANDBOX === '1' || process.env.DOCKER === '1') {
		return true;
	}
	return isRunningAsRoot();
}

function isRunningAsRoot(): boolean {
	return typeof process.getuid === 'function' && process.getuid() === 0;
}

function findChromePath(): string {
	const candidates = [
		process.env.PUPPETEER_EXECUTABLE_PATH,
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
		throw new Error(
			'Chrome/Chromium not found. Install chromium or set the PUPPETEER_EXECUTABLE_PATH (or CHROME_PATH) environment variable.',
		);
	}
}

export async function closeBrowser(): Promise<void> {
	const promise = browserPromise;
	browserPromise = null;
	activeBrowser = null;
	if (!promise) {
		return;
	}
	const browser = await promise.catch(() => null);
	await browser?.close().catch(() => {});
}

process.once('exit', () => {
	activeBrowser?.process()?.kill('SIGKILL');
});
