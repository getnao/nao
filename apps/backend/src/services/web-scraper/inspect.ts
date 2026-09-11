import type { WebRobotRecipe } from '@nao/shared/web-robot';
import * as cheerio from 'cheerio';

import { WebRobotBrowserSession } from './browser-loader';
import { loadHttpSource } from './http-loader';
import { fetchRobotsTxt, RobotsTxtPolicy } from './robots-txt';
import type { WebRobotCapturedResponse, WebRobotLoadedSource } from './types';
import { assertPublicHttpUrl } from './url-policy';

export type WebRobotInspectOptions = {
	url: string;
	loader: 'http' | 'browser';
	allowedHosts: string[];
	selectors?: string[];
	actions?: Extract<WebRobotRecipe['stages'][number]['source'], { type: 'browser' }>['actions'];
	capture?: Extract<WebRobotRecipe['stages'][number]['source'], { type: 'browser' }>['capture'];
	env?: Record<string, string>;
};

export type WebRobotInspectResult = {
	url: string;
	finalUrl: string;
	status: number;
	title?: string;
	matches: Record<string, number>;
	captures: WebRobotCapturedResponse[];
	htmlPreview?: string;
};

const inspectRecipe = (options: WebRobotInspectOptions): WebRobotRecipe => ({
	version: 1,
	allowedHosts: options.allowedHosts,
	request: { concurrency: 1, delayMs: 0, timeoutMs: 20_000, retries: 0 },
	limits: {
		maxPages: 1,
		maxItems: 1,
		maxRequests: 10,
		maxDurationMs: 60_000,
		maxResponseBytes: 2 * 1024 * 1024,
	},
	publish: { minItems: 0, maxRemovedPercent: 100 },
	identity: { fields: ['url'] },
	respectRobotsTxt: false,
	stages: [
		{
			id: 'inspect',
			source:
				options.loader === 'browser'
					? browserSource(options)
					: { type: 'http', url: options.url, method: 'GET', headers: {} },
			output: 'product',
		},
	],
});

export const inspectWebRobotUrl = async (options: WebRobotInspectOptions): Promise<WebRobotInspectResult> => {
	const recipe = inspectRecipe(options);
	const url = await assertPublicHttpUrl(options.url, recipe.allowedHosts);
	const robots = new RobotsTxtPolicy(fetchRobotsTxt);
	if (recipe.respectRobotsTxt) {
		await robots.assertAllowed(url.toString());
	}

	let loaded: WebRobotLoadedSource;
	if (options.loader === 'browser') {
		const browser = new WebRobotBrowserSession();
		try {
			loaded = await browser.load(browserSource(options), {
				recipe,
				scope: {},
				env: options.env ?? {},
			});
		} finally {
			await browser.close();
		}
	} else {
		loaded = await loadHttpSource(
			{ type: 'http', url: options.url, method: 'GET', headers: {} },
			{ recipe, scope: {}, env: options.env ?? {} },
		);
	}

	const $ = cheerio.load(loaded.bodyText ?? '');
	const matches = Object.fromEntries(
		(options.selectors ?? []).map((selector) => {
			try {
				return [selector, $(selector).length];
			} catch {
				return [selector, -1];
			}
		}),
	);

	return {
		url: loaded.url,
		finalUrl: loaded.finalUrl,
		status: loaded.status,
		title: $('title').first().text().trim() || undefined,
		matches,
		captures: loaded.captures,
		htmlPreview: loaded.bodyText?.slice(0, 20_000),
	};
};

const browserSource = (
	options: WebRobotInspectOptions,
): Extract<WebRobotRecipe['stages'][number]['source'], { type: 'browser' }> => ({
	type: 'browser',
	url: options.url,
	headers: {},
	viewport: { width: 1440, height: 1000 },
	actions: options.actions ?? [],
	capture: options.capture ?? [],
});
