import type { WebRobotBrowserAction, WebRobotRecipe, WebRobotSource } from '@nao/shared/web-robot';
import type { Browser, HTTPRequest, HTTPResponse, Page } from 'puppeteer-core';

import { browserLaunchArgs, findChromePath } from '../../utils/headless-browser';
import { headersForOrigin, resolveHeaders } from './request';
import type { TemplateScope } from './template';
import { renderStringTemplate, renderTemplate } from './template';
import type { WebRobotCapturedResponse, WebRobotLoadedSource } from './types';
import { assertPublicHttpUrl } from './url-policy';

type BrowserSource = Extract<WebRobotSource, { type: 'browser' }>;

export type BrowserLoaderOptions = {
	recipe: WebRobotRecipe;
	scope: TemplateScope;
	env: Record<string, string>;
	signal?: AbortSignal;
};

const ALLOWED_RESOURCE_TYPES = new Set(['document', 'script', 'xhr', 'fetch', 'stylesheet', 'eventsource']);

export class WebRobotBrowserSession {
	private browserPromise: Promise<Browser> | null = null;
	private readonly resolvedHosts = new Map<string, Promise<void>>();

	async load(source: BrowserSource, options: BrowserLoaderOptions): Promise<WebRobotLoadedSource> {
		const rendered = renderTemplate(source, options.scope);
		const url = renderStringTemplate(rendered.url, options.scope);
		await assertPublicHttpUrl(url, options.recipe.allowedHosts);

		const browser = await this.browser();
		const page = await browser.newPage();
		const captures: WebRobotCapturedResponse[] = [];
		const pendingCaptures = new Set<Promise<void>>();
		let requests = 0;
		let mainStatus = 0;

		try {
			await page.setViewport(rendered.viewport);
			if (options.recipe.request.userAgent) {
				await page.setUserAgent(options.recipe.request.userAgent);
			}
			const headers = resolveHeaders(rendered.headers, options.env);
			const initialOrigin = new URL(url).origin;
			page.setDefaultTimeout(options.recipe.request.timeoutMs);
			await page.setRequestInterception(true);

			page.on('request', (request) => {
				void this.handleRequest(request, options, headers, initialOrigin).catch(() => request.abort());
			});
			page.on('response', (response) => {
				const pending = captureResponse(
					response,
					rendered.capture,
					captures,
					options.recipe.limits.maxResponseBytes,
				)
					.catch(() => undefined)
					.finally(() => pendingCaptures.delete(pending));
				pendingCaptures.add(pending);
			});
			page.on('request', () => {
				requests += 1;
			});

			const response = await page.goto(url, {
				waitUntil: 'domcontentloaded',
				timeout: options.recipe.request.timeoutMs,
			});
			mainStatus = response?.status() ?? 0;

			for (const action of rendered.actions) {
				throwIfAborted(options.signal);
				await runAction(page, action, options.recipe.request.timeoutMs);
			}
			await Promise.all(pendingCaptures);

			return {
				url,
				finalUrl: page.url(),
				status: mainStatus,
				contentType: response?.headers()['content-type'],
				bodyText: await page.content(),
				captures,
				requests,
			};
		} finally {
			await page.close().catch(() => undefined);
		}
	}

	async close(): Promise<void> {
		const browser = await this.browserPromise?.catch(() => null);
		this.browserPromise = null;
		await browser?.close().catch(() => undefined);
	}

	private browser(): Promise<Browser> {
		this.browserPromise ??= launchBrowser();
		return this.browserPromise;
	}

	private async handleRequest(
		request: HTTPRequest,
		options: BrowserLoaderOptions,
		configuredHeaders: Record<string, string>,
		initialOrigin: string,
	): Promise<void> {
		const url = request.url();
		if (url.startsWith('data:') || url.startsWith('blob:')) {
			await request.continue();
			return;
		}
		if (!ALLOWED_RESOURCE_TYPES.has(request.resourceType())) {
			await request.abort();
			return;
		}

		const parsed = new URL(url);
		let checked = this.resolvedHosts.get(parsed.hostname);
		if (!checked) {
			checked = assertPublicHttpUrl(url, options.recipe.allowedHosts).then(() => undefined);
			this.resolvedHosts.set(parsed.hostname, checked);
		}
		await checked;
		throwIfAborted(options.signal);
		await request.continue({
			headers: {
				...request.headers(),
				...headersForOrigin(configuredHeaders, parsed.origin, initialOrigin),
			},
		});
	}
}

const launchBrowser = async (): Promise<Browser> => {
	const puppeteer = await import('puppeteer-core');
	return puppeteer.default.launch({
		headless: true,
		executablePath: findChromePath(),
		args: browserLaunchArgs(),
	});
};

const runAction = async (page: Page, action: WebRobotBrowserAction, timeoutMs: number): Promise<void> => {
	switch (action.type) {
		case 'waitForSelector':
			await page.waitForSelector(action.selector, { timeout: action.timeoutMs ?? timeoutMs });
			return;
		case 'waitForResponse':
			await page.waitForResponse((response) => matchesPattern(response.url(), action.urlPattern), {
				timeout: action.timeoutMs ?? timeoutMs,
			});
			return;
		case 'waitForNavigation':
			await page.waitForNavigation({ timeout: action.timeoutMs ?? timeoutMs });
			return;
		case 'click':
			await page.click(action.selector);
			return;
		case 'select':
			await page.select(action.selector, action.value);
			return;
		case 'scroll':
			for (let index = 0; index < action.times; index += 1) {
				await page.evaluate(() => window.scrollBy(0, window.innerHeight));
				await new Promise((resolve) => setTimeout(resolve, action.delayMs));
			}
			return;
		case 'delay':
			await new Promise((resolve) => setTimeout(resolve, action.ms));
			return;
	}
};

const captureResponse = async (
	response: HTTPResponse,
	rules: BrowserSource['capture'],
	captures: WebRobotCapturedResponse[],
	maxResponseBytes: number,
): Promise<void> => {
	for (const rule of rules) {
		if (!matchesPattern(response.url(), rule.urlPattern)) {
			continue;
		}

		const text = await response.text();
		if (Buffer.byteLength(text) > maxResponseBytes) {
			throw new Error(`Captured response exceeds the ${maxResponseBytes} byte limit`);
		}
		captures.push({
			name: rule.name,
			url: response.url(),
			status: response.status(),
			contentType: response.headers()['content-type'],
			body: rule.body === 'json' ? JSON.parse(text) : text,
		});
	}
};

const matchesPattern = (url: string, pattern: string): boolean => {
	if (pattern.includes('*')) {
		const regex = new RegExp(`^${pattern.split('*').map(escapeRegex).join('.*')}$`);
		return regex.test(url);
	}
	return url.includes(pattern);
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const throwIfAborted = (signal?: AbortSignal): void => {
	if (signal?.aborted) {
		throw new Error('Web robot run was cancelled');
	}
};
