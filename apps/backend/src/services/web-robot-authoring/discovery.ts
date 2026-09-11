import type { WebRobotElementFingerprint, WebRobotRecipe, WebRobotRecordFilter } from '@nao/shared/web-robot';
import type { Cheerio, CheerioAPI } from 'cheerio';
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

import { detectLoadedSourceBlockers } from '../web-scraper/blockers';
import { WebRobotBrowserSession } from '../web-scraper/browser-loader';
import { embeddedDocumentsFromHtml, type WebRobotEmbeddedSource } from '../web-scraper/extract-embedded';
import { loadHttpSource } from '../web-scraper/http-loader';
import { fetchRobotsTxt, RobotsTxtPolicy } from '../web-scraper/robots-txt';
import { getPathValue } from '../web-scraper/template';
import type { WebRobotLoadedSource, WebRobotSourceBlocker } from '../web-scraper/types';
import { assertPublicHttpUrl, canonicalHttpUrl, normalizeHttpUrl } from '../web-scraper/url-policy';
import type {
	WebRobotApiCandidate,
	WebRobotBrowserActionCandidate,
	WebRobotDetailCandidate,
	WebRobotDomCandidate,
	WebRobotEmbeddedCandidate,
	WebRobotEndpointCandidate,
	WebRobotJsonFieldMap,
	WebRobotJsonLdCandidate,
	WebRobotPaginationCandidate,
	WebRobotSourceDiscovery,
} from './types';

const MAX_DISCOVERY_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_DETAIL_PAGES = 3;
const MAX_JSON_NODES = 500;
const MAX_ANCHORS = 500;
const MAX_SCRIPT_SOURCES = 3;
const MAX_ENDPOINT_PROBES = 6;

const PRODUCT_PATH_PATTERN = /(product|produkt|item|article|part|sku|detail|catalogue|catalog)/i;
const PRODUCT_DETAIL_PATH_PATTERN =
	/(?:^|\/)(?:p|product|products|produkt|produkte|produits|prodotti|item|article|part|sku|detail|conf)(?:\/|$)|\/\d{5,}\/?$/i;
const URL_FIELD_PATTERN = /(canonical_?url|product_?url|detail_?url|url|uri|href|link|permalink|slug)/i;
const URL_FIELD_EXCLUDE_PATTERN = /(image|images|thumbnail|picture|avatar|document|download|pdf|file)/i;
const NAME_FIELD_PATTERN = /(name|title|label|display_?name|product_?name)/i;

type DiscoveryOptions = {
	url: string;
	env: Record<string, string>;
};

type LoadedPage = {
	loaded: WebRobotLoadedSource;
	loader: 'http' | 'browser';
};

export const discoverWebRobotSource = async (options: DiscoveryOptions): Promise<WebRobotSourceDiscovery> => {
	const destination = await resolveDestination(options.url);
	const recipe = inspectionRecipe(destination.allowedHosts);
	const robots = new RobotsTxtPolicy(fetchRobotsTxt);
	const warnings: string[] = [];
	const errors: string[] = [];

	const httpLoaded = await loadHttp(destination.url, recipe, options.env, robots);

	const httpPage = { loaded: httpLoaded, loader: 'http' as const };
	const discovery = emptyDiscovery(options.url, destination.url, destination.allowedHosts, httpLoaded.status);
	const probedResources = new Set<string>();
	analyzeLoadedPage(httpPage, discovery);
	await discoverReferencedEndpoints(httpLoaded, recipe, options.env, robots, discovery, warnings, probedResources);

	if (shouldInspectWithBrowser(discovery) && looksLikeHtml(httpLoaded)) {
		let browser: WebRobotBrowserSession | undefined;
		try {
			const inspection = await loadBrowser(destination.url, recipe, options.env, robots);
			browser = inspection.browser;
			discovery.browserStatus = inspection.loaded.status;
			analyzeLoadedPage({ loaded: inspection.loaded, loader: 'browser' }, discovery);
			await discoverReferencedEndpoints(
				inspection.loaded,
				recipe,
				options.env,
				robots,
				discovery,
				warnings,
				probedResources,
			);
			try {
				await observeBrowserPagination(browser, destination.url, recipe, options.env, discovery);
			} catch (error) {
				warnings.push(`Browser interaction observation failed: ${errorMessage(error)}`);
			}
		} catch (error) {
			warnings.push(`Browser inspection failed: ${errorMessage(error)}`);
		} finally {
			await browser?.close().catch(() => undefined);
		}
	}

	discovery.detailCandidates = await inspectDetailCandidates(
		recipe,
		options.env,
		robots,
		destination.allowedHosts,
		collectProductUrls(discovery),
		warnings,
	);
	discovery.warnings.push(...warnings);
	discovery.errors.push(...errors);
	return discovery;
};

const emptyDiscovery = (
	url: string,
	finalUrl: string,
	allowedHosts: string[],
	httpStatus: number,
): WebRobotSourceDiscovery => ({
	url,
	finalUrl,
	allowedHosts,
	httpStatus,
	apiCandidates: [],
	endpointCandidates: [],
	jsonLdCandidates: [],
	embeddedCandidates: [],
	domCandidates: [],
	detailCandidates: [],
	paginationCandidates: [],
	browserActionCandidates: [],
	blockers: [],
	warnings: [],
	errors: [],
});

const inspectionRecipe = (allowedHosts: string[]): WebRobotRecipe => ({
	version: 1,
	allowedHosts,
	request: { concurrency: 1, delayMs: 0, timeoutMs: 20_000, retries: 1 },
	limits: {
		maxPages: 1,
		maxItems: 100,
		maxRequests: 40,
		maxDurationMs: 90_000,
		maxResponseBytes: MAX_DISCOVERY_RESPONSE_BYTES,
	},
	publish: { minItems: 0, maxRemovedPercent: 100 },
	identity: { fields: ['url'] },
	respectRobotsTxt: false,
	stages: [
		{
			id: 'inspect',
			source: { type: 'http', url: 'https://example.invalid', method: 'GET', headers: {} },
			output: 'product',
		},
	],
});

const resolveDestination = async (inputUrl: string): Promise<{ url: string; allowedHosts: string[] }> => {
	let current = normalizeHttpUrl(inputUrl);
	const hosts = new Set([current.hostname]);

	for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
		await assertPublicHttpUrl(current.toString(), [current.hostname]);
		const response = await fetch(current, {
			method: 'GET',
			redirect: 'manual',
			signal: AbortSignal.timeout(15_000),
		});
		await response.body?.cancel().catch(() => undefined);
		if (![301, 302, 303, 307, 308].includes(response.status)) {
			return { url: current.toString(), allowedHosts: [...hosts] };
		}

		const location = response.headers.get('location');
		if (!location) {
			return { url: current.toString(), allowedHosts: [...hosts] };
		}
		const next = normalizeHttpUrl(location, current.toString());
		if (!isSameSiteRedirect(current.hostname, next.hostname)) {
			throw new Error(`Catalogue URL redirects to a different host: ${next.hostname}`);
		}
		await assertPublicHttpUrl(next.toString(), [next.hostname]);
		current = next;
		hosts.add(next.hostname);
	}

	throw new Error(`Too many redirects while resolving ${inputUrl}`);
};

const isSameSiteRedirect = (from: string, to: string): boolean => {
	return from === to || from === `www.${to}` || to === `www.${from}`;
};

const loadHttp = async (
	url: string,
	recipe: WebRobotRecipe,
	env: Record<string, string>,
	robots: RobotsTxtPolicy,
): Promise<WebRobotLoadedSource> => {
	if (recipe.respectRobotsTxt) {
		await robots.assertAllowed(url);
	}
	return loadHttpSource({ type: 'http', url, method: 'GET', headers: {} }, { recipe, scope: {}, env });
};

const loadBrowser = async (
	url: string,
	recipe: WebRobotRecipe,
	env: Record<string, string>,
	robots: RobotsTxtPolicy,
): Promise<{ loaded: WebRobotLoadedSource; browser: WebRobotBrowserSession }> => {
	if (recipe.respectRobotsTxt) {
		await robots.assertAllowed(url);
	}
	const browser = new WebRobotBrowserSession();
	try {
		return {
			loaded: await browser.load(browserInspectionSource(url, true), { recipe, scope: {}, env }),
			browser,
		};
	} catch (error) {
		await browser.close().catch(() => undefined);
		throw error;
	}
};

const browserInspectionSource = (url: string, scroll: boolean) =>
	({
		type: 'browser',
		url,
		headers: {},
		viewport: { width: 1440, height: 1000 },
		actions: [
			{ type: 'delay', ms: 1_500 },
			...(scroll ? [{ type: 'scroll', times: 2, delayMs: 300 } as const] : []),
		],
		capture: [{ name: 'catalogue', urlPattern: '*', body: 'json' }],
	}) satisfies Extract<WebRobotRecipe['stages'][number]['source'], { type: 'browser' }>;

const observeBrowserPagination = async (
	browser: WebRobotBrowserSession,
	url: string,
	recipe: WebRobotRecipe,
	env: Record<string, string>,
	discovery: WebRobotSourceDiscovery,
): Promise<void> => {
	const initialBrowserProducts = discovery.domCandidates.some((candidate) => candidate.loader === 'browser');
	const hasNextLink = discovery.paginationCandidates.some((candidate) => candidate.type === 'nextLink');
	const actionSelectors = [
		...new Set(
			discovery.browserActionCandidates.flatMap((candidate) => [
				candidate.selector,
				...(candidate.selectors ?? []),
			]),
		),
	];
	if ((!initialBrowserProducts && !actionSelectors.length) || hasNextLink) {
		return;
	}
	const clickSelectors = () => {
		const clickCandidates = discovery.paginationCandidates.filter((candidate) => candidate.type === 'click');
		return [
			...new Set(clickCandidates.flatMap((candidate) => [candidate.selector, ...(candidate.selectors ?? [])])),
		];
	};

	const observed = await browser.probePagination(
		browserInspectionSource(url, false),
		{ recipe, scope: {}, env },
		initialBrowserProducts ? clickSelectors() : [],
		actionSelectors,
	);
	markObservedBrowserActions(discovery, observed.actions ?? []);
	if (observed.loaded && observed.actions?.length) {
		analyzeLoadedPage({ loaded: observed.loaded, loader: 'browser' }, discovery);
	}
	const hasBrowserProducts =
		initialBrowserProducts || discovery.domCandidates.some((candidate) => candidate.loader === 'browser');
	const pagination =
		hasBrowserProducts && !initialBrowserProducts
			? await browser.probePagination(
					browserInspectionSourceWithActions(url, discovery.browserActionCandidates),
					{ recipe, scope: {}, env },
					clickSelectors(),
					[],
				)
			: observed;
	applyObservedPagination(discovery, pagination, clickSelectors());
};

const markObservedBrowserActions = (discovery: WebRobotSourceDiscovery, observedSelectors: string[]): void => {
	for (const selector of observedSelectors) {
		const candidate = discovery.browserActionCandidates.find(
			(candidate) => candidate.selector === selector || candidate.selectors?.includes(selector),
		);
		if (candidate) {
			candidate.selector = selector;
			candidate.observed = true;
		}
	}
};

const browserInspectionSourceWithActions = (
	url: string,
	actions: WebRobotBrowserActionCandidate[],
): Extract<WebRobotRecipe['stages'][number]['source'], { type: 'browser' }> => {
	const source = browserInspectionSource(url, false);
	return {
		...source,
		actions: [
			...actions
				.filter((action) => action.observed)
				.flatMap((action) => [
					{ type: 'click' as const, selector: action.selector, selectors: action.selectors },
					{ type: 'delay' as const, ms: 500 },
				]),
			...source.actions,
		],
	};
};

const applyObservedPagination = (
	discovery: WebRobotSourceDiscovery,
	observed: { clickSelector?: string; scroll?: boolean },
	clickSelectors: string[],
): void => {
	if (observed.clickSelector) {
		const clickCandidates = discovery.paginationCandidates.filter((candidate) => candidate.type === 'click');
		const observedFingerprint = clickCandidates.find(
			(candidate) =>
				candidate.selector === observed.clickSelector ||
				candidate.selectors?.includes(observed.clickSelector ?? ''),
		)?.fingerprint;
		discovery.paginationCandidates.push({
			type: 'click',
			selector: observed.clickSelector,
			selectors: [
				observed.clickSelector,
				...clickSelectors.filter((selector) => selector !== observed.clickSelector),
			],
			fingerprint: observedFingerprint,
			waitMs: 1_000,
			observed: true,
		});
		return;
	}
	if (observed.scroll) {
		discovery.paginationCandidates.push({ type: 'scroll', waitMs: 1_000, observed: true });
	}
};

const analyzeLoadedPage = (page: LoadedPage, discovery: WebRobotSourceDiscovery): void => {
	const { loaded, loader } = page;
	if (loaded.bodyJson) {
		const candidates = jsonArrayCandidates(loaded.bodyJson, loaded.finalUrl, 'GET', 'api', loaded.status);
		discovery.apiCandidates.push(...candidates);
		discovery.paginationCandidates.push(
			...jsonPaginationCandidates(loaded.bodyJson, {
				url: loaded.finalUrl,
				itemCount: candidates[0]?.itemCount,
			}),
		);
	}

	for (const capture of loaded.captures) {
		if (!capture.body || typeof capture.body !== 'object') {
			continue;
		}
		const method = capture.requestMethod ?? 'GET';
		const candidates = jsonArrayCandidates(
			capture.body,
			capture.url,
			method,
			'network',
			capture.status,
			capture.requestBody,
			capture.requestContentType,
			capture.name,
			capturePattern(capture.url),
		);
		discovery.apiCandidates.push(...candidates);
		discovery.paginationCandidates.push(
			...jsonPaginationCandidates(capture.body, {
				url: capture.url,
				requestBody: capture.requestBody,
				itemCount: candidates[0]?.itemCount,
			}),
		);
	}

	if (!loaded.bodyText || !loaded.bodyText.includes('<')) {
		addBlockers(discovery, detectWebRobotSourceBlockers(page, discovery));
		return;
	}
	const $ = cheerio.load(loaded.bodyText);
	discovery.title ??= $('title').first().text().trim() || undefined;
	discovery.jsonLdCandidates.push(...jsonLdCandidates($, loaded.finalUrl, loader));
	discovery.embeddedCandidates.push(...embeddedCandidates(loaded.bodyText, loaded.finalUrl, loader));
	discovery.domCandidates.push(...domCandidates($, loaded.finalUrl, loader));

	discovery.paginationCandidates.push(...domPaginationCandidates($));
	if (loader === 'browser') {
		for (const candidate of browserActionCandidates($)) {
			if (!discovery.browserActionCandidates.some((existing) => existing.selector === candidate.selector)) {
				discovery.browserActionCandidates.push(candidate);
			}
		}
	}
	addBlockers(discovery, detectWebRobotSourceBlockers(page, discovery, $));
};

const discoverReferencedEndpoints = async (
	loaded: WebRobotLoadedSource,
	recipe: WebRobotRecipe,
	env: Record<string, string>,
	robots: RobotsTxtPolicy,
	discovery: WebRobotSourceDiscovery,
	warnings: string[],
	probedResources: Set<string>,
): Promise<void> => {
	if (!loaded.bodyText || !loaded.bodyText.includes('<')) {
		return;
	}
	const $ = cheerio.load(loaded.bodyText);
	const endpoints = collectEndpointCandidates($, loaded.finalUrl, loaded.bodyText);
	for (const scriptUrl of scriptSourceUrls($, loaded.finalUrl)) {
		if (!probedResources.add(`script:${scriptUrl}`)) {
			continue;
		}
		try {
			if (recipe.respectRobotsTxt) {
				await robots.assertAllowed(scriptUrl);
			}
			const script = await loadHttpSource(
				{ type: 'http', url: scriptUrl, method: 'GET', headers: {} },
				{ recipe, scope: {}, env },
			);
			for (const raw of endpointLiterals(script.bodyText ?? '')) {
				addEndpointCandidate(endpoints, raw, loaded.finalUrl, 'GET', 'script');
			}
		} catch (error) {
			warnings.push(`Referenced script ${scriptUrl} could not be inspected: ${errorMessage(error)}`);
		}
	}

	for (const endpoint of [...endpoints.values()].slice(0, MAX_ENDPOINT_PROBES)) {
		if (discovery.apiCandidates.some((candidate) => candidate.url === endpoint.url && candidate.method === 'GET')) {
			endpoint.probed = true;
			endpoint.productCandidate = true;
			continue;
		}
		if (endpoint.method !== 'GET' || !probedResources.add(`endpoint:${endpoint.url}`)) {
			continue;
		}
		try {
			if (recipe.respectRobotsTxt) {
				await robots.assertAllowed(endpoint.url);
			}
			const result = await loadHttpSource(
				{ type: 'api', url: endpoint.url, method: 'GET', query: {}, headers: {} },
				{ recipe, scope: {}, env },
			);
			endpoint.probed = true;
			endpoint.status = result.status;
			if (!result.bodyJson) {
				continue;
			}
			const candidates = jsonArrayCandidates(result.bodyJson, result.finalUrl, 'GET', 'api', result.status);
			endpoint.productCandidate = candidates.length > 0;
			discovery.apiCandidates.push(...candidates);
			discovery.paginationCandidates.push(
				...jsonPaginationCandidates(result.bodyJson, {
					url: result.finalUrl,
					itemCount: candidates[0]?.itemCount,
				}),
			);
		} catch (error) {
			warnings.push(`Referenced endpoint ${endpoint.url} could not be probed: ${errorMessage(error)}`);
		}
	}
	for (const endpoint of [...endpoints.values()].slice(0, 12)) {
		if (
			!discovery.endpointCandidates.some(
				(existing) => existing.url === endpoint.url && existing.method === endpoint.method,
			)
		) {
			discovery.endpointCandidates.push(endpoint);
		}
	}
};

const collectEndpointCandidates = (
	$: CheerioAPI,
	baseUrl: string,
	html: string,
): Map<string, WebRobotEndpointCandidate> => {
	const endpoints = new Map<string, WebRobotEndpointCandidate>();
	$('form[action]')
		.toArray()
		.slice(0, 8)
		.forEach((element) => {
			const form = $(element);
			const method = form.attr('method')?.toUpperCase() === 'POST' ? 'POST' : 'GET';
			const url = endpointUrl(form.attr('action'), baseUrl);
			if (!url) {
				return;
			}
			if (method === 'GET') {
				const parsed = new URL(url);
				form.find('input[name][value], select[name]').each((_, input) => {
					const control = $(input);
					const name = control.attr('name');
					const value = control.is('select')
						? control.find('option[selected]').attr('value')
						: control.attr('value');
					if (name && value !== undefined && !SENSITIVE_ENDPOINT_KEY.test(name)) {
						parsed.searchParams.set(name, value);
					}
				});
				addEndpointCandidate(endpoints, parsed.toString(), baseUrl, 'GET', 'form');
				return;
			}
			addEndpointCandidate(endpoints, url, baseUrl, 'POST', 'form');
		});
	for (const raw of endpointLiterals(html)) {
		addEndpointCandidate(endpoints, raw, baseUrl, 'GET', 'html');
	}
	$('script:not([src])')
		.toArray()
		.slice(0, 8)
		.forEach((element) => {
			for (const raw of endpointLiterals($(element).text())) {
				addEndpointCandidate(endpoints, raw, baseUrl, 'GET', 'script');
			}
		});
	return endpoints;
};

const scriptSourceUrls = ($: CheerioAPI, baseUrl: string): string[] => {
	return [
		...new Set(
			$('script[src]')
				.toArray()
				.map((element) => endpointUrl($(element).attr('src'), baseUrl))
				.filter((url): url is string => Boolean(url)),
		),
	].slice(0, MAX_SCRIPT_SOURCES);
};

const addEndpointCandidate = (
	endpoints: Map<string, WebRobotEndpointCandidate>,
	raw: string | undefined,
	baseUrl: string,
	method: 'GET' | 'POST',
	source: WebRobotEndpointCandidate['source'],
): void => {
	const url = endpointUrl(raw, baseUrl);
	if (!url || !looksLikeEndpoint(url, source)) {
		return;
	}
	const key = `${method}:${url}`;
	endpoints.set(key, endpoints.get(key) ?? { url, method, source, probed: false });
};

const endpointUrl = (raw: string | undefined, baseUrl: string): string | null => {
	if (!raw || /^(?:data:|javascript:|mailto:|tel:)/i.test(raw)) {
		return null;
	}
	const absolute = absoluteSameHostUrl(raw.replaceAll('\\/', '/'), baseUrl);
	if (!absolute || absolute.includes('${') || absolute.includes('{{')) {
		return null;
	}
	const url = new URL(absolute);
	for (const key of [...url.searchParams.keys()]) {
		if (SENSITIVE_ENDPOINT_KEY.test(key)) {
			url.searchParams.delete(key);
		}
	}
	return url.toString();
};

const endpointLiterals = (text: string): string[] => {
	return [...text.matchAll(/["'`]((?:https?:\/\/|\/)[^"'`\\\s<>]{3,2048})["'`]/g)]
		.map((match) => match[1]?.replaceAll('\\/', '/'))
		.filter((value): value is string => Boolean(value));
};

const looksLikeEndpoint = (url: string, source: WebRobotEndpointCandidate['source']): boolean => {
	if (source === 'form') {
		return true;
	}
	const parsed = new URL(url);
	if (STATIC_ENDPOINT_PATH.test(parsed.pathname)) {
		return false;
	}
	return parsed.pathname.endsWith('.json') || ENDPOINT_PATH_PATTERN.test(`${parsed.pathname}${parsed.search}`);
};

const ENDPOINT_PATH_PATTERN = /(api|graphql|search|catalog|catalogue|items|results|query|filter|listing)/i;
const STATIC_ENDPOINT_PATH = /\.(?:css|js|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot|mp4|webm|pdf|zip)$/i;
const SENSITIVE_ENDPOINT_KEY = /(authorization|cookie|csrf|token|secret|password|api[_-]?key|session|auth)/i;

export const detectWebRobotSourceBlockers = (
	page: LoadedPage,
	discovery: WebRobotSourceDiscovery,
	$?: CheerioAPI,
): WebRobotSourceBlocker[] => {
	const hasCandidates =
		discovery.apiCandidates.length +
			discovery.jsonLdCandidates.length +
			discovery.embeddedCandidates.length +
			discovery.domCandidates.length >
		0;
	return detectLoadedSourceBlockers(page.loaded, page.loader, hasCandidates, $);
};

const addBlockers = (discovery: WebRobotSourceDiscovery, blockers: WebRobotSourceBlocker[]): void => {
	for (const blocker of blockers) {
		if (
			!discovery.blockers.some(
				(existing) =>
					existing.kind === blocker.kind &&
					existing.loader === blocker.loader &&
					existing.status === blocker.status,
			)
		) {
			discovery.blockers.push(blocker);
		}
	}
};

const shouldInspectWithBrowser = (discovery: WebRobotSourceDiscovery): boolean => {
	return discovery.apiCandidates.length === 0;
};

const looksLikeHtml = (loaded: WebRobotLoadedSource): boolean => {
	return Boolean(loaded.bodyText?.includes('<'));
};

const jsonArrayCandidates = (
	body: unknown,
	url: string,
	method: string,
	kind: 'api' | 'network',
	status: number,
	requestBody?: unknown,
	requestContentType?: string,
	captureName?: string,
	capturePattern?: string,
): WebRobotApiCandidate[] => {
	const candidates: WebRobotApiCandidate[] = [];
	for (const entry of jsonArrayEntries(body)) {
		const fields = inferJsonFields(entry.items.slice(0, 10));
		const score = scoreJsonFields(fields, entry.items.length, method, kind);
		if (score <= 0) {
			continue;
		}
		candidates.push({
			kind,
			url,
			method,
			status,
			requestBody,
			requestContentType,
			captureName,
			capturePattern,
			itemsPath: entry.path,
			itemCount: entry.items.length,
			fields,
			fieldNames: Object.keys(fields),
			identityField: fields.sku?.path ?? fields.external_id?.path,
			urlField: fields.url?.path,
			nameField: fields.name?.path,
			productUrls: entry.items.flatMap((item) => jsonItemUrl(item, fields.url?.path, url)).slice(0, 25),
			sample: sampleJson(entry.items[0]!),
			score,
		});
	}
	return candidates.sort((left, right) => right.score - left.score).slice(0, 6);
};

const jsonArrayEntries = (body: unknown): { path?: string; items: Record<string, unknown>[] }[] => {
	const entries: { path?: string; items: Record<string, unknown>[] }[] = [];
	let visited = 0;
	const visit = (value: unknown, path: string[]): void => {
		if (visited++ > MAX_JSON_NODES || value === null || value === undefined) {
			return;
		}
		if (Array.isArray(value)) {
			const items = value.filter(
				(item): item is Record<string, unknown> =>
					Boolean(item) && typeof item === 'object' && !Array.isArray(item),
			);
			if (items.length >= 2) {
				entries.push({ path: path.length ? path.join('.') : undefined, items });
			}
			for (const item of value.slice(0, 10)) {
				visit(item, path);
			}
			return;
		}
		if (typeof value !== 'object') {
			return;
		}
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) {
				visit(entry, [...path, key]);
			}
		}
	};
	visit(body, []);
	return entries;
};

const inferJsonFields = (items: Record<string, unknown>[]): WebRobotJsonFieldMap => {
	const flattened = flattenJsonItems(items);
	const fields: WebRobotJsonFieldMap = {};
	const choose = (
		name: string,
		pattern: RegExp,
		options: { required?: boolean; multiple?: boolean; transforms?: string[]; exclude?: RegExp } = {},
	) => {
		const match = flattened.find(
			({ path, value }) =>
				!fields[name] &&
				pattern.test(path[path.length - 1]!) &&
				(!options.exclude || !options.exclude.test(path.join('.'))) &&
				usableJsonValue(value),
		);
		if (match) {
			const { exclude: _exclude, ...fieldOptions } = options;
			fields[name] = { path: match.path.join('.'), ...fieldOptions };
		}
	};

	choose('url', URL_FIELD_PATTERN, {
		required: true,
		transforms: ['absoluteUrl'],
		exclude: URL_FIELD_EXCLUDE_PATTERN,
	});
	choose('name', NAME_FIELD_PATTERN, { required: true });
	choose('sku', /(sku|mpn|part_?number|article|product_?code|item_?number|code)/i);
	choose('external_id', /^(id|product_?id)$/i);
	choose('description', /(description|summary|short_?text|long_?text)/i);
	choose('brand', /^(brand|manufacturer|vendor)$/i);
	choose('price', /^(price|amount|sale_?price)$/i, { transforms: ['parsePrice'] });
	choose('currency', /^(currency|currency_?code)$/i);
	choose('categories', /(categor|tag|group)/i, { multiple: true });
	choose('images', /(image|images|image_?url|thumbnail|picture)/i, { multiple: true, transforms: ['absoluteUrl'] });
	choose('documents', /(document|documents|download|datasheet|manual|pdf)/i, { multiple: true });
	return fields;
};

const flattenJsonItems = (items: Record<string, unknown>[]): { path: string[]; value: unknown }[] => {
	const flattened = new Map<string, unknown>();
	for (const item of items.slice(0, 10)) {
		for (const entry of flattenJson(item)) {
			flattened.set(entry.path.join('.'), entry.value);
		}
	}
	return [...flattened].map(([key, value]) => ({ path: key.split('.'), value }));
};

const flattenJson = (value: unknown, path: string[] = [], depth = 0): { path: string[]; value: unknown }[] => {
	if (depth > 3 || value === null || typeof value !== 'object') {
		return path.length ? [{ path, value }] : [];
	}
	if (Array.isArray(value)) {
		return path.length ? [{ path, value }] : [];
	}
	return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
		if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) {
			return [];
		}
		return flattenJson(entry, [...path, key], depth + 1);
	});
};

const usableJsonValue = (value: unknown): boolean => {
	if (Array.isArray(value)) {
		return value.length > 0;
	}
	return value !== undefined && value !== null && String(value).trim() !== '';
};

const scoreJsonFields = (
	fields: WebRobotJsonFieldMap,
	itemCount: number,
	method: string,
	kind: 'api' | 'network',
): number => {
	let score = Math.min(itemCount, 10) * 2;
	if (fields.url) {
		score += 20;
	}
	if (fields.name) {
		score += 20;
	}
	if (fields.sku || fields.external_id) {
		score += 25;
	}
	if (fields.description || fields.price || fields.images) {
		score += 10;
	}
	if (kind === 'api') {
		score += 15;
	}
	if (method === 'GET') {
		score += 10;
	}
	return score;
};

const jsonPaginationCandidates = (
	body: unknown,
	request: { url?: string; requestBody?: unknown; itemCount?: number } = {},
): WebRobotPaginationCandidate[] => {
	const candidates: WebRobotPaginationCandidate[] = [];
	let cursorPath: string | undefined;
	let totalPath: string | undefined;
	const visit = (value: unknown, path: string[] = []): void => {
		if (!value || typeof value !== 'object') {
			return;
		}
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			const nextPath = [...path, key];
			if (typeof entry === 'string' && /^(next|next_url|nextPage|next_page|nextLink)$/i.test(key) && entry) {
				candidates.push({ type: 'nextPath', path: nextPath.join('.') });
			}
			if (
				(typeof entry === 'string' || typeof entry === 'number') &&
				/^(next_?cursor|nextCursorToken|next_?token|endCursor)$/i.test(key) &&
				String(entry) !== ''
			) {
				cursorPath ??= nextPath.join('.');
			}
			if (
				typeof entry === 'number' &&
				/^(totalPages|pageCount|total_pages|numberOfPages|totalNumberOfPages)$/i.test(key)
			) {
				candidates.push({ type: 'page', pageVariable: 'page', totalPagesPath: nextPath.join('.') });
			}
			if (
				typeof entry === 'number' &&
				/^(total|total_?count|total_?items|result_?count|hit_?count)$/i.test(key)
			) {
				totalPath ??= nextPath.join('.');
			}
			if (entry && typeof entry === 'object') {
				visit(entry, nextPath);
			}
		}
	};
	visit(body);
	if (cursorPath) {
		const firstCursor = requestValue(request, /^(cursor|after|next_?cursor|next_?token)$/i);
		candidates.push({
			type: 'cursor',
			cursorVariable: 'cursor',
			...(firstCursor !== undefined ? { firstCursor: String(firstCursor) } : {}),
			nextCursorPath: cursorPath,
		});
	}
	const offset = requestValue(request, /^(offset|start|from)$/i);
	const pageSize = requestValue(request, /^(limit|page_?size|per_?page|size)$/i) ?? request.itemCount;
	if (totalPath && (offset !== undefined || pageSize !== undefined)) {
		candidates.push({
			type: 'offset',
			offsetVariable: 'offset',
			firstOffset: Number(offset ?? 0),
			pageSize: Math.max(1, Math.min(Number(pageSize ?? 50), 1_000)),
			totalPath,
		});
	}
	return dedupePaginationCandidates(candidates).slice(0, 4);
};

const requestValue = (
	request: { url?: string; requestBody?: unknown },
	pattern: RegExp,
): string | number | undefined => {
	if (request.url) {
		try {
			for (const [key, value] of new URL(request.url).searchParams.entries()) {
				if (pattern.test(key)) {
					const numeric = Number(value);
					return Number.isFinite(numeric) && value !== '' ? numeric : value;
				}
			}
		} catch {
			return undefined;
		}
	}
	for (const entry of flattenJson(request.requestBody)) {
		const key = entry.path[entry.path.length - 1];
		if (key && pattern.test(key) && (typeof entry.value === 'string' || typeof entry.value === 'number')) {
			return entry.value;
		}
	}
	return undefined;
};

const dedupePaginationCandidates = (candidates: WebRobotPaginationCandidate[]): WebRobotPaginationCandidate[] => {
	const seen = new Set<string>();
	return candidates.filter((candidate) => {
		const key = JSON.stringify(candidate);
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
};

const jsonLdCandidates = ($: CheerioAPI, pageUrl: string, loader: 'http' | 'browser'): WebRobotJsonLdCandidate[] => {
	const items: Record<string, unknown>[] = [];
	$('script[type="application/ld+json"]').each((_, element) => {
		const text = $(element).contents().text().trim();
		if (!text) {
			return;
		}
		try {
			items.push(...flattenJsonLd(JSON.parse(text)));
		} catch {
			return;
		}
	});

	const products = items.filter((item) => hasSchemaType(item, 'Product'));
	const listItems = items.filter((item) => hasSchemaType(item, 'ListItem'));
	const itemLists = items.filter((item) => hasSchemaType(item, 'ItemList'));
	const candidates: WebRobotJsonLdCandidate[] = [];

	if (products.length) {
		candidates.push({
			loader,
			pageUrl,
			schemaType: 'Product',
			itemCount: products.length,
			fields: inferJsonFields(products.slice(0, 10)),
			productUrls: products.flatMap((item) => jsonLdProductUrl(item)).slice(0, 20),
			sample: sampleJson(products[0]!),
			score: 45 + Math.min(products.length, 10) * 4,
		});
	}
	if (listItems.length) {
		const urls = listItems.flatMap(jsonLdListItemUrl).filter(Boolean) as string[];
		candidates.push({
			loader,
			pageUrl,
			schemaType: 'ListItem',
			itemCount: listItems.length,
			fields: {
				url: { path: 'item.url', required: true, transforms: ['absoluteUrl'] },
				name: { path: 'item.name', required: true },
				sku: { path: 'item.sku' },
			},
			productUrls: urls,
			sample: sampleJson(listItems[0]!),
			score: 35 + Math.min(listItems.length, 10) * 4 + (urls.length ? 15 : 0),
		});
	}
	if (itemLists.length) {
		const urls = itemLists.flatMap((item) => itemListUrls(item)).slice(0, 20);
		candidates.push({
			loader,
			pageUrl,
			schemaType: 'ItemList',
			itemCount: urls.length || itemLists.length,
			fields: {},
			productUrls: urls,
			sample: sampleJson(itemLists[0]!),
			score: urls.length ? 40 + Math.min(urls.length, 10) * 3 : 15,
		});
	}
	return candidates;
};

const embeddedCandidates = (html: string, pageUrl: string, loader: 'http' | 'browser'): WebRobotEmbeddedCandidate[] => {
	const candidates: WebRobotEmbeddedCandidate[] = [];
	const documents = embeddedDocumentsFromHtml(html, ['microdata', 'rdfa', 'scriptJson']);
	const documentsBySource = new Map<WebRobotEmbeddedSource, Record<string, unknown>[]>();
	for (const document of documents) {
		documentsBySource.set(document.source, [...(documentsBySource.get(document.source) ?? []), document.value]);
	}
	for (const [source, values] of documentsBySource) {
		const entries = values.flatMap((value) => jsonArrayEntries(value));
		if (source !== 'scriptJson' && values.length > 1) {
			entries.push({ items: values });
		}
		for (const entry of entries) {
			const filtered = productItems(entry.items);
			const items = filtered.items;
			if (items.length < 2) {
				continue;
			}
			const fields = inferJsonFields(items.slice(0, 10));
			if (!fields.url && !fields.name && !fields.sku) {
				continue;
			}
			const schemaTypes = embeddedSchemaTypes(items, source);
			candidates.push({
				loader,
				pageUrl,
				source,
				itemsPath: entry.path,
				...(schemaTypes ? { schemaTypes } : {}),
				...(filtered.where ? { where: filtered.where } : {}),
				itemCount: items.length,
				fields,
				productUrls: items.flatMap((item) => jsonItemUrl(item, fields.url?.path, pageUrl)).slice(0, 20),
				sample: sampleJson(items[0]!),
				score: scoreJsonFields(fields, items.length, 'GET', 'network') + (source === 'scriptJson' ? 8 : 12),
			});
		}
	}
	return dedupeEmbeddedCandidates(candidates)
		.sort((left, right) => right.score - left.score)
		.slice(0, 6);
};

const productItems = (
	items: Record<string, unknown>[],
): { items: Record<string, unknown>[]; where?: WebRobotRecordFilter[] } => {
	const paths = [...new Set(flattenJsonItems(items).map((entry) => entry.path.join('.')))];
	for (const path of paths) {
		const field = path.split('.').pop() ?? '';
		if (!/^(type|kind|result_?type|record_?type|content_?type|entry_?type|item_?type)$/i.test(field)) {
			continue;
		}
		const values = items.map((item) => getPathValue(item, path));
		const distinct = [...new Set(values.filter((value): value is string => typeof value === 'string'))];
		const productValues = distinct.filter((value) => /product|item|article|part|sku/i.test(value));
		if (productValues.length === 0 || productValues.length === distinct.length) {
			continue;
		}
		const wanted = productValues.slice(0, 8);
		return {
			items: items.filter((item) => wanted.some((value) => getPathValue(item, path) === value)),
			where: [wanted.length === 1 ? { path, equals: wanted[0]! } : { path, in: wanted }],
		};
	}
	return { items };
};

const embeddedSchemaTypes = (
	items: Record<string, unknown>[],
	source: WebRobotEmbeddedSource,
): string[] | undefined => {
	if (source === 'scriptJson' || source === 'openGraph') {
		return undefined;
	}
	const types = new Set<string>();
	for (const item of items.slice(0, 10)) {
		const value = item['@type'] ?? item.itemtype ?? item.type;
		for (const entry of Array.isArray(value) ? value : [value]) {
			if (typeof entry === 'string') {
				types.add(entry.split('/').pop() ?? entry);
			}
		}
	}
	return types.size ? [...types] : undefined;
};

const dedupeEmbeddedCandidates = (candidates: WebRobotEmbeddedCandidate[]): WebRobotEmbeddedCandidate[] => {
	const seen = new Set<string>();
	return candidates.filter((candidate) => {
		const key = [
			candidate.loader,
			candidate.source,
			candidate.itemsPath ?? '',
			JSON.stringify(candidate.where ?? []),
		].join('|');
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
};

const flattenJsonLd = (value: unknown): Record<string, unknown>[] => {
	if (Array.isArray(value)) {
		return value.flatMap(flattenJsonLd);
	}
	if (!value || typeof value !== 'object') {
		return [];
	}
	const object = value as Record<string, unknown>;
	const graph = Array.isArray(object['@graph']) ? object['@graph'].flatMap(flattenJsonLd) : [];
	return [object, ...graph];
};

const hasSchemaType = (item: Record<string, unknown>, wanted: string): boolean => {
	const type = item['@type'];
	const types = Array.isArray(type) ? type : [type];
	return types.some((entry) => typeof entry === 'string' && entry.toLowerCase() === wanted.toLowerCase());
};

const jsonLdProductUrl = (item: Record<string, unknown>): string[] => {
	return [item.url, item['@id'], item.canonicalUrl].filter((value): value is string => typeof value === 'string');
};

const jsonLdListItemUrl = (item: Record<string, unknown>): string[] => {
	const nested = item.item;
	if (nested && typeof nested === 'object') {
		return jsonLdProductUrl(nested as Record<string, unknown>);
	}
	return typeof item.url === 'string' ? [item.url] : [];
};

const itemListUrls = (item: Record<string, unknown>): string[] => {
	const elements = item.itemListElement;
	if (!Array.isArray(elements)) {
		return [];
	}
	return elements.flatMap((entry) =>
		entry && typeof entry === 'object' ? jsonLdListItemUrl(entry as Record<string, unknown>) : [],
	);
};

const domCandidates = ($: CheerioAPI, pageUrl: string, loader: 'http' | 'browser'): WebRobotDomCandidate[] => {
	const grouped = new Map<string, WebRobotDomCandidate>();
	$('a[href]')
		.toArray()
		.slice(0, MAX_ANCHORS)
		.forEach((element) => {
			const anchor = $(element);
			const href = anchor.attr('href');
			const absolute = absoluteSameHostUrl(href, pageUrl);
			if (!absolute) {
				return;
			}
			const text = anchor.text().replace(/\s+/g, ' ').trim();
			const productSignal = PRODUCT_PATH_PATTERN.test(absolute) || productClasses(anchor);
			if (!productSignal && !text) {
				return;
			}

			for (const candidate of anchorItemCandidates($, anchor, productSignal, loader)) {
				const key = `${candidate.itemSelector}|${candidate.linkSelector ?? ''}`;
				const existing = grouped.get(key);
				if (existing) {
					if (!existing.productUrls.includes(absolute)) {
						existing.productUrls.push(absolute);
					}
					continue;
				}
				grouped.set(key, {
					...candidate,
					itemCount: 0,
					productUrls: [absolute],
					sample: { text, href: absolute },
				});
			}
		});
	return [...grouped.values()]
		.map((candidate) => {
			const productUrlCount = candidate.productUrls.filter((url) => isProductDetailUrl(url, pageUrl)).length;
			return {
				...candidate,
				itemCount: candidate.productUrls.length,
				productUrlCount,
				score: candidate.score + Math.min(productUrlCount, 10) * 3,
			};
		})
		.filter((candidate) => candidate.itemCount >= 2 && candidate.productUrlCount >= 2)
		.sort((left, right) => right.score - left.score)
		.slice(0, 8);
};

const fingerprintForSelector = (
	root: Cheerio<AnyNode>,
	selector: string | undefined,
	includeText = false,
): WebRobotElementFingerprint | undefined => {
	if (!selector) {
		return undefined;
	}
	try {
		const element = root.find(selector).first();
		return element.length ? elementFingerprint(element, includeText) : undefined;
	} catch {
		return undefined;
	}
};

const anchorItemCandidates = (
	$: CheerioAPI,
	anchor: Cheerio<AnyNode>,
	productSignal: boolean,
	loader: 'http' | 'browser',
): Omit<WebRobotDomCandidate, 'itemCount' | 'productUrls' | 'sample'>[] => {
	const candidates: Omit<WebRobotDomCandidate, 'itemCount' | 'productUrls' | 'sample'>[] = [];
	const anchorSelector = selectorFor(anchor);
	if (anchorSelector && countSelector($, anchorSelector) >= 2) {
		candidates.push({
			loader,
			itemSelector: anchorSelector,
			itemSelectors: selectorCandidatesFor(anchor),
			itemFingerprint: elementFingerprint(anchor),
			fields: {
				url: {
					attr: 'href',
					required: true,
					fingerprint: elementFingerprint(anchor),
					transforms: ['absoluteUrl'],
				},
				name: {
					required: true,
					fingerprint: elementFingerprint(anchor),
					transforms: ['normalizeWhitespace'],
				},
			},
			score: 35 + (productSignal ? 20 : 0),
		});
	}

	let current = anchor.parent();
	for (let depth = 0; depth < 3 && current.length; depth += 1) {
		const selector = selectorFor(current);
		if (!selector) {
			current = current.parent();
			continue;
		}
		const count = countSelector($, selector);
		if (count < 2 || count > 200) {
			current = current.parent();
			continue;
		}
		const linkSelector = anchorSelector
			? relativeAnchorSelector(anchorSelector)
			: contextualAnchorSelector($, anchor);
		const linkSelectors = linkSelectorCandidates($, anchor, linkSelector);
		const descriptionSelectors = descendantSelectors(current, [
			'[itemprop="description"]',
			'[class*="description" i]',
			'p',
		]);
		const priceSelectors = descendantSelectors(current, ['[itemprop="price"]', '[class*="price" i]', '.price']);
		candidates.push({
			loader,
			itemSelector: selector,
			itemSelectors: selectorCandidatesFor(current),
			itemFingerprint: elementFingerprint(current),
			linkSelector,
			linkSelectors,
			fields: {
				url: {
					selector: linkSelector,
					selectors: linkSelectors,
					fingerprint: elementFingerprint(anchor),
					attr: 'href',
					required: true,
					transforms: ['absoluteUrl'],
				},
				name: {
					selector: linkSelector,
					selectors: [...linkSelectors, 'h1', 'h2', 'h3', '[itemprop="name"]', '[class*="title" i]'],
					fingerprint: elementFingerprint(anchor),
					required: true,
					transforms: ['normalizeWhitespace'],
				},
				...(descriptionSelectors.length
					? {
							description: {
								selector: descriptionSelectors[0],
								selectors: descriptionSelectors,
								fingerprint: fingerprintForSelector(current, descriptionSelectors[0]),
								transforms: ['normalizeWhitespace'],
							},
						}
					: {}),
				...(priceSelectors.length
					? {
							price: {
								selector: priceSelectors[0],
								selectors: priceSelectors,
								fingerprint: fingerprintForSelector(current, priceSelectors[0]),
								transforms: ['normalizeWhitespace', 'parsePrice'],
							},
						}
					: {}),
				images: {
					selector: 'img',
					selectors: ['img', '[itemprop="image"]'],
					fingerprint: fingerprintForSelector(current, 'img'),
					attr: 'src',
					multiple: true,
					transforms: ['absoluteUrl'],
				},
			},
			score:
				30 +
				Math.min(count, 20) +
				(productSignal ? 20 : 0) +
				(descriptionSelectors.length ? 4 : 0) +
				(priceSelectors.length ? 6 : 0),
		});
		current = current.parent();
	}
	return candidates;
};

const STABLE_SELECTOR_ATTRS = [
	'data-testid',
	'data-test',
	'data-cy',
	'data-product',
	'data-product-id',
	'itemtype',
	'itemprop',
];

const VOLATILE_FINGERPRINT_ATTRIBUTES = new Set(['action', 'href', 'src', 'srcset']);

const elementFingerprint = (element: Cheerio<AnyNode>, includeText = false): WebRobotElementFingerprint | undefined => {
	const node = element.get(0);
	const tag =
		element.prop('tagName')?.toLowerCase() ?? (node && 'name' in node ? node.name.toLowerCase() : undefined);
	if (!tag || node?.type !== 'tag') {
		return undefined;
	}
	const attributes = Object.fromEntries(
		Object.entries(node.attribs ?? {})
			.filter(([name]) => name !== 'class' && name !== 'style' && !VOLATILE_FINGERPRINT_ATTRIBUTES.has(name))
			.slice(0, 16)
			.map(([name, value]) => [name, String(value).slice(0, 512)]),
	);
	const text = element.text().replace(/\s+/g, ' ').trim().slice(0, 160);
	return {
		tag,
		attributes,
		classes: (node.attribs?.class ?? '').split(/\s+/).filter(Boolean).slice(0, 8),
		childTags: element
			.children()
			.toArray()
			.map((child) => (child.type === 'tag' ? child.name.toLowerCase() : undefined))
			.filter((child): child is string => Boolean(child))
			.slice(0, 16),
		...(includeText && text ? { text } : {}),
	};
};

const selectorCandidatesFor = (element: Cheerio<AnyNode>): string[] => {
	const node = element.get(0);
	const tag =
		element.prop('tagName')?.toLowerCase() ?? (node && 'name' in node ? node.name.toLowerCase() : undefined);
	if (!tag) {
		return [];
	}
	const selectors: string[] = [];
	const id = element.attr('id');
	if (id && /^[A-Za-z][\w-]*$/.test(id)) {
		selectors.push(`#${id}`);
	}
	for (const attr of STABLE_SELECTOR_ATTRS) {
		const value = element.attr(attr);
		if (value && /^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,80}$/.test(value)) {
			selectors.push(`${tag}[${attr}="${value.replace(/"/g, '\\"')}"]`);
		}
	}
	const classes = (element.attr('class') ?? '')
		.split(/\s+/)
		.filter((name) => /^[A-Za-z_-][\w-]*$/.test(name))
		.slice(0, 3);
	if (classes.length) {
		selectors.push(`${tag}.${classes.join('.')}`);
	}
	if (element.attr('itemscope') !== undefined) {
		selectors.push(`${tag}[itemscope]`);
	}
	return [...new Set(selectors)].slice(0, 6);
};

const selectorFor = (element: Cheerio<AnyNode>): string | null => {
	return selectorCandidatesFor(element)[0] ?? null;
};

const relativeAnchorSelector = (anchorSelector: string): string => {
	return anchorSelector.startsWith('a.') || anchorSelector === 'a[href]' ? anchorSelector : 'a[href]';
};

const contextualAnchorSelector = ($: CheerioAPI, anchor: Cheerio<AnyNode>): string => {
	const container = anchor.closest('h1, h2, h3, h4, h5, h6, [class*="title" i]');
	const selector = container.length ? selectorFor(container) : null;
	return selector && countSelector($, `${selector} a[href]`) > 0 ? `${selector} a[href]` : 'a[href]';
};

const linkSelectorCandidates = ($: CheerioAPI, anchor: Cheerio<AnyNode>, primary: string | undefined): string[] => {
	const contextual = contextualAnchorSelector($, anchor);
	return [
		...new Set(
			[primary, selectorFor(anchor), contextual, 'a[href]'].filter((selector): selector is string =>
				Boolean(selector),
			),
		),
	].slice(0, 6);
};

const descendantSelectors = (root: Cheerio<AnyNode>, selectors: string[]): string[] => {
	return selectors.filter((selector) => {
		try {
			const match = root.find(selector).first();
			return match.length > 0 && match.text().trim().length > 0;
		} catch {
			return false;
		}
	});
};

const countSelector = ($: CheerioAPI, selector: string): number => {
	try {
		return $(selector).length;
	} catch {
		return 0;
	}
};

const productClasses = (anchor: Cheerio<AnyNode>): boolean => {
	let current = anchor;
	for (let index = 0; index < 3 && current.length; index += 1) {
		const marker = `${current.attr('class') ?? ''} ${current.attr('id') ?? ''}`;
		if (PRODUCT_PATH_PATTERN.test(marker)) {
			return true;
		}
		current = current.parent();
	}
	return false;
};

const absoluteSameHostUrl = (href: string | undefined, baseUrl: string): string | null => {
	if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) {
		return null;
	}
	try {
		const url = new URL(href, baseUrl);
		const base = new URL(baseUrl);
		return url.hostname === base.hostname ? canonicalHttpUrl(url.toString()) : null;
	} catch {
		return null;
	}
};

const isProductDetailUrl = (url: string, baseUrl: string): boolean => productDetailUrl(url, baseUrl) !== null;

const productDetailUrl = (url: string, baseUrl: string): string | null => {
	const absolute = absoluteSameHostUrl(url, baseUrl);
	if (!absolute) {
		return null;
	}
	const parsed = new URL(absolute);
	if (parsed.search || !PRODUCT_DETAIL_PATH_PATTERN.test(parsed.pathname)) {
		return null;
	}
	return absolute;
};

const clickControlSelectors = ($: CheerioAPI): string[] => {
	const selectors = new Set(
		[
			'button[data-testid*="next" i]',
			'button[aria-label*="next" i]',
			'button[class*="next" i]',
			'button[id*="next" i]',
			'button[data-testid*="more" i]',
			'button[aria-label*="more" i]',
			'button[class*="more" i]',
			'button[id*="more" i]',
			'[role="button"][aria-label*="next" i]',
			'[role="button"][aria-label*="more" i]',
		].filter((selector) => countSelector($, selector) > 0),
	);
	$('button, a, [role="button"]').each((_, element) => {
		const node = $(element);
		const label = [
			node.text(),
			node.attr('aria-label'),
			node.attr('title'),
			node.attr('value'),
			node.attr('data-testid'),
		]
			.filter(Boolean)
			.join(' ');
		if (
			/^(?:next|next page|load more|show more|more results|see more|view more)$/i.test(
				label.trim().replace(/\s+/g, ' '),
			)
		) {
			const selector = selectorFor(node);
			if (selector) {
				selectors.add(selector);
			}
		}
	});
	return [...selectors].slice(0, 6);
};

const browserActionCandidates = ($: CheerioAPI): WebRobotBrowserActionCandidate[] => {
	const candidates: WebRobotBrowserActionCandidate[] = [];
	$('button, input[type="button"], input[type="submit"], [role="button"]')
		.toArray()
		.slice(0, 200)
		.forEach((element) => {
			if (candidates.length >= 4) {
				return;
			}
			const control = $(element);
			const label = [
				control.text(),
				control.attr('aria-label'),
				control.attr('title'),
				control.attr('value'),
				control.attr('data-testid'),
			]
				.filter(Boolean)
				.join(' ')
				.replace(/\s+/g, ' ')
				.trim();
			const context = `${control.attr('id') ?? ''} ${control.attr('class') ?? ''} ${control
				.closest('[id],[class],[role]')
				.attr('id')} ${control.closest('[id],[class],[role]').attr('class')} ${control
				.closest('[id],[class],[role]')
				.attr('role')}`;
			const consentControl =
				CONSENT_ACTION_PATTERN.test(label) ||
				(CONSENT_CONTEXT_PATTERN.test(context) && CONSENT_DISMISS_PATTERN.test(label));
			if (!consentControl || label.length > 160) {
				return;
			}
			const selectors = selectorCandidatesFor(control);
			if (!selectors.length) {
				return;
			}
			candidates.push({
				type: 'click',
				kind: 'consent',
				selector: selectors[0]!,
				selectors,
				fingerprint: elementFingerprint(control, true),
				observed: false,
				label: label || undefined,
			});
		});
	return candidates;
};

const CONSENT_ACTION_PATTERN =
	/\b(?:accept|accept all|agree|agree and continue|allow all|consent|got it|i understand|understood|akzeptieren|alle akzeptieren|zustimmen|alle zulassen)\b/i;
const CONSENT_CONTEXT_PATTERN = /(?:cookie|consent|gdpr|privacy|tracking)/i;
const CONSENT_DISMISS_PATTERN = /^(?:ok|okay|continue|dismiss|close|schliessen|schließen|weiter)$/i;

const domPaginationCandidates = ($: CheerioAPI): WebRobotPaginationCandidate[] => {
	const candidates: WebRobotPaginationCandidate[] = [];
	const nextLinkSelectors = [
		'a[rel~="next"]',
		'link[rel="next"]',
		'.pagination a[href*="page"]',
		'a[aria-label*="next" i]',
	].filter((selector) => countSelector($, selector) > 0);
	if (nextLinkSelectors.length) {
		candidates.push({
			type: 'nextLink',
			selector: nextLinkSelectors[0]!,
			selectors: nextLinkSelectors,
			fingerprint: fingerprintForSelector($.root(), nextLinkSelectors[0], true),
			attr: 'href',
		});
	}
	const clickSelectors = clickControlSelectors($);
	if (clickSelectors.length) {
		candidates.push({
			type: 'click',
			selector: clickSelectors[0]!,
			selectors: clickSelectors,
			fingerprint: fingerprintForSelector($.root(), clickSelectors[0], true),
			waitMs: 1_000,
		});
	}
	return candidates;
};

const collectProductUrls = (discovery: WebRobotSourceDiscovery): string[] => {
	const urls = [
		...discovery.apiCandidates.flatMap((candidate) => candidate.productUrls),
		...discovery.jsonLdCandidates.flatMap((candidate) => candidate.productUrls),
		...discovery.embeddedCandidates.flatMap((candidate) => candidate.productUrls),
		...discovery.domCandidates.flatMap((candidate) => candidate.productUrls),
	];
	return [
		...new Set(
			urls.map((url) => productDetailUrl(url, discovery.finalUrl)).filter((url): url is string => Boolean(url)),
		),
	].slice(0, 25);
};

const jsonItemUrl = (item: Record<string, unknown>, path: string | undefined, baseUrl: string): string[] => {
	if (!path) {
		return [];
	}
	const value = path.split('.').reduce<unknown>((current, part) => {
		return current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined;
	}, item);
	if (typeof value !== 'string' || !value) {
		return [];
	}
	try {
		return [canonicalHttpUrl(new URL(value, baseUrl).toString())];
	} catch {
		return [];
	}
};

const inspectDetailCandidates = async (
	recipe: WebRobotRecipe,
	env: Record<string, string>,
	robots: RobotsTxtPolicy,
	allowedHosts: string[],
	productUrls: string[],
	warnings: string[],
): Promise<WebRobotDetailCandidate[]> => {
	const details: WebRobotDetailCandidate[] = [];
	for (const url of productUrls.slice(0, MAX_DETAIL_PAGES)) {
		try {
			await assertPublicHttpUrl(url, allowedHosts);
			const loaded = await loadHttp(url, recipe, env, robots);
			if (!loaded.bodyText) {
				continue;
			}
			const detail = analyzeDetailPage(loaded.bodyText, loaded.finalUrl);
			if (detail) {
				details.push(detail);
			}
		} catch (error) {
			warnings.push(`Detail inspection failed for ${url}: ${errorMessage(error)}`);
		}
	}
	return details.sort((left, right) => right.score - left.score);
};

const analyzeDetailPage = (html: string, url: string): WebRobotDetailCandidate | null => {
	const $ = cheerio.load(html);
	const title = $('title').first().text().trim() || undefined;
	const nameSelector = firstTextSelector($, [
		'main h1',
		'[itemprop="name"]',
		'.product-title',
		'.product-name',
		'h1',
	]);
	const name = nameSelector ? $(nameSelector).first().text().replace(/\s+/g, ' ').trim() : undefined;
	const sku = firstSkuSelector($, name);
	const hasJsonLdProduct = jsonLdCandidates($, url, 'http').some((candidate) => candidate.schemaType === 'Product');
	const attributesEach = countSelector($, 'table tr') >= 2 ? 'table tr' : undefined;
	const documentSelector = countSelector(
		$,
		'a[href*="pdf" i], a[href*="download" i], a[href*="datasheet" i], a[href*="manual" i]',
	)
		? 'a[href*="pdf" i], a[href*="download" i], a[href*="datasheet" i], a[href*="manual" i]'
		: undefined;
	const score =
		(hasJsonLdProduct ? 35 : 0) +
		(nameSelector ? 20 : 0) +
		(sku ? 20 : 0) +
		(attributesEach ? 10 : 0) +
		(documentSelector ? 10 : 0);
	if (!nameSelector && !sku && !hasJsonLdProduct) {
		return null;
	}
	return {
		url,
		loader: 'http',
		title,
		nameSelector,
		skuSelector: sku?.selector,
		skuAttr: sku?.attr,
		attributesEach,
		documentSelector,
		hasJsonLdProduct,
		score,
	};
};

const firstTextSelector = ($: CheerioAPI, selectors: string[]): string | undefined => {
	return selectors.find((selector) => countSelector($, selector) > 0 && $(selector).first().text().trim().length > 0);
};

const firstSkuSelector = ($: CheerioAPI, productName?: string): { selector: string; attr?: string } | undefined => {
	for (const selector of ['[itemprop="sku"]', '[data-sku]', '.sku', '[class*="sku" i]', 'main h2', 'h2']) {
		if (!countSelector($, selector)) {
			continue;
		}
		const element = $(selector).first();
		const value = selector === '[data-sku]' ? element.attr('data-sku') : element.text();
		const normalizedValue = value?.replace(/\s+/g, ' ').trim();
		const explicitSkuField = selector === '[itemprop="sku"]' || selector === '[data-sku]';
		if (
			normalizedValue &&
			normalizedValue !== productName &&
			/^[A-Za-z0-9][A-Za-z0-9._/ -]{2,80}$/.test(normalizedValue) &&
			(explicitSkuField || /\d/.test(normalizedValue))
		) {
			return { selector, ...(selector === '[data-sku]' ? { attr: 'data-sku' } : {}) };
		}
	}
	return undefined;
};

const capturePattern = (url: string): string => {
	try {
		const parsed = new URL(url);
		return `*${parsed.pathname}*`;
	} catch {
		return '*';
	}
};

const sampleJson = (value: Record<string, unknown>): Record<string, unknown> => {
	return Object.fromEntries(
		Object.entries(value)
			.slice(0, 20)
			.map(([key, entry]) => [key, truncateJsonValue(entry)]),
	);
};

const truncateJsonValue = (value: unknown): unknown => {
	if (typeof value === 'string') {
		return value.length > 300 ? `${value.slice(0, 300)}…` : value;
	}
	if (Array.isArray(value)) {
		return value.slice(0, 5).map(truncateJsonValue);
	}
	if (value && typeof value === 'object') {
		return sampleJson(value as Record<string, unknown>);
	}
	return value;
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
