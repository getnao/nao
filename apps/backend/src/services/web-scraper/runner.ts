import {
	emptyWebRobotRunStats,
	type WebRobotExtract,
	type WebRobotRecipe,
	type WebRobotRunStats,
	type WebRobotSource,
	type WebRobotStage,
} from '@nao/shared/web-robot';

import { WebRobotBrowserSession } from './browser-loader';
import { extractDomRecords, findNextLink } from './extract-dom';
import { extractJsonRecords } from './extract-json';
import { extractJsonLdRecords } from './extract-json-ld';
import { loadHttpSource } from './http-loader';
import { type NormalizedProducts, normalizeProducts } from './records';
import { readResponseWithLimit } from './request';
import { RobotsTxtPolicy } from './robots-txt';
import type { TemplateScope } from './template';
import { getPathValue, renderStringTemplate } from './template';
import type {
	WebRobotExecutionOptions,
	WebRobotExecutionResult,
	WebRobotLoadedSource,
	WebRobotRunEvent,
	WebRobotStageRecord,
} from './types';
import { assertPublicHttpUrl, canonicalHttpUrl } from './url-policy';

type RunnerContext = {
	recipe: WebRobotRecipe;
	env: Record<string, string>;
	signal?: AbortSignal;
	stats: WebRobotRunStats;
	events: WebRobotRunEvent[];
	onEvent?: (event: WebRobotRunEvent) => void | Promise<void>;
	startedAt: number;
	robots: RobotsTxtPolicy;
	browser: WebRobotBrowserSession;
};

export const runWebRobotRecipe = async (
	options: WebRobotExecutionOptions,
): Promise<WebRobotExecutionResult & { normalized: NormalizedProducts }> => {
	const recipe = options.dryRun ? dryRunRecipe(options.recipe) : options.recipe;
	const context = createContext(recipe, options);
	const stageRecords = new Map<string, WebRobotStageRecord[]>();
	const productRecords: WebRobotStageRecord[] = [];

	try {
		for (const stage of recipe.stages) {
			throwIfStopped(context);
			const records = await runStage(stage, context, stageRecords);
			stageRecords.set(stage.emit ?? stage.id, records);
			if (stage.output === 'product') {
				productRecords.push(...records);
			}
		}
	} finally {
		await context.browser.close();
	}

	const normalized = normalizeProducts(productRecords, recipe, options.runId);
	return { stats: context.stats, stageRecords, products: normalized.products, events: context.events, normalized };
};

const runStage = async (
	stage: WebRobotStage,
	context: RunnerContext,
	stageRecords: Map<string, WebRobotStageRecord[]>,
): Promise<WebRobotStageRecord[]> => {
	const parents = stage.forEach
		? (stageRecords.get(stage.forEach.from) ?? []).slice(0, stage.forEach.limit)
		: [undefined];
	const records: WebRobotStageRecord[] = [];
	const concurrency = Math.max(1, stage.source.type === 'browser' ? 1 : context.recipe.request.concurrency);

	for (let index = 0; index < parents.length; index += concurrency) {
		throwIfStopped(context);
		const batch = parents.slice(index, index + concurrency);
		const batchRecords = await Promise.all(
			batch.map(async (parent, batchIndex) => {
				try {
					if (batchIndex > 0) {
						await delayBetweenRequests(context, batchIndex);
					}
					const parentRecords: WebRobotStageRecord[] = [];
					const scope = parentScope(stage, parent);
					await runStageInput(stage, scope, parent, context, parentRecords);
					return parentRecords;
				} catch (error) {
					if (!stage.forEach || context.signal?.aborted) {
						throw error;
					}
					await recordError(context, parent?.url ?? stage.source.url, error, 'request');
					return [];
				}
			}),
		);
		records.push(...batchRecords.flat());
	}

	return records;
};

const runStageInput = async (
	stage: WebRobotStage,
	scope: TemplateScope,
	parent: WebRobotStageRecord | undefined,
	context: RunnerContext,
	records: WebRobotStageRecord[],
): Promise<void> => {
	let nextSource: WebRobotSource | undefined = stage.source;
	let page = stage.paginate?.type === 'page' ? stage.paginate.firstPage : 1;
	let pageCount = 0;
	const maxPages = Math.min(stage.paginate?.maxPages ?? 1, context.recipe.limits.maxPages);

	while (nextSource && pageCount < maxPages) {
		throwIfStopped(context);
		const pageScope = { ...scope, page };
		const loaded = await loadSource(nextSource, pageScope, context);
		const extracted = extractLoaded(loaded, stage.extract, context);
		const pageRecords = extracted.map((data) => ({
			stageId: stage.id,
			url: recordUrl(data, loaded),
			data: { ...(parent?.data ?? {}), ...data },
		}));
		records.push(...pageRecords);
		context.stats.itemsExtracted += pageRecords.length;
		assertLimits(context);
		for (const record of pageRecords) {
			await emit(context, {
				type: 'item',
				stageId: stage.id,
				url: record.url,
				data: record.data,
				createdAt: now(),
			});
		}

		pageCount += 1;
		nextSource = nextPageSource(stage, loaded, extracted, page);
		if (nextSource) {
			page += 1;
			await delayBetweenRequests(context);
		}
	}
};

const loadSource = async (
	source: WebRobotSource,
	scope: TemplateScope,
	context: RunnerContext,
): Promise<WebRobotLoadedSource> => {
	const renderedUrl = renderSourceUrl(source, scope);
	await assertPublicHttpUrl(renderedUrl, context.recipe.allowedHosts);
	if (context.recipe.respectRobotsTxt) {
		await context.robots.assertAllowed(renderedUrl, context.recipe.request.userAgent);
	}

	const loaded =
		source.type === 'browser'
			? await context.browser.load(source, {
					recipe: context.recipe,
					scope,
					env: context.env,
					signal: context.signal,
				})
			: await loadHttpSource(source, {
					recipe: context.recipe,
					scope,
					env: context.env,
					signal: context.signal,
				});

	context.stats.pagesDiscovered += 1;
	context.stats.pagesFetched += 1;
	context.stats.requests += loaded.requests;
	assertLimits(context);
	await emit(context, {
		type: 'page',
		url: loaded.finalUrl,
		status: loaded.status,
		createdAt: now(),
	});
	return loaded;
};

const extractLoaded = (
	loaded: WebRobotLoadedSource,
	extract: WebRobotExtract | undefined,
	context: RunnerContext,
): Record<string, unknown>[] => {
	if (!extract) {
		return [{ url: loaded.finalUrl, status: loaded.status }];
	}

	try {
		switch (extract.type) {
			case 'dom':
				return extractDomRecords(loaded.bodyText ?? '', extract, loaded.finalUrl);
			case 'json':
				return extractJsonRecords(loaded.bodyJson ?? parseJson(loaded.bodyText), extract, loaded.finalUrl);
			case 'network':
				return loaded.captures
					.filter((capture) => capture.name === extract.capture)
					.flatMap((capture) => extractJsonRecords(capture.body, extract, loaded.finalUrl));
			case 'jsonld':
				return extractJsonLdRecords(loaded.bodyText ?? '', extract, loaded.finalUrl);
		}
	} catch (error) {
		void recordError(context, loaded.finalUrl, error, 'extract');
		return [];
	}
};

const nextPageSource = (
	stage: WebRobotStage,
	loaded: WebRobotLoadedSource,
	extracted: Record<string, unknown>[],
	page: number,
): WebRobotSource | undefined => {
	const pagination = stage.paginate;
	if (!pagination) {
		return undefined;
	}

	if (pagination.type === 'nextLink') {
		const href = loaded.bodyText
			? findNextLink(loaded.bodyText, pagination.selector, pagination.attr, loaded.finalUrl)
			: null;
		return href ? ({ ...stage.source, url: href } as WebRobotSource) : undefined;
	}

	if (pagination.type === 'nextPath') {
		const next = getPathValue(loaded.bodyJson ?? parseJson(loaded.bodyText), pagination.path);
		return typeof next === 'string' && next
			? ({ ...stage.source, url: new URL(next, loaded.finalUrl).toString() } as WebRobotSource)
			: undefined;
	}

	if (pagination.type === 'page') {
		if (pagination.totalPagesPath) {
			const totalPages = Number(
				getPathValue(loaded.bodyJson ?? parseJson(loaded.bodyText), pagination.totalPagesPath),
			);
			return Number.isFinite(totalPages) && page < totalPages ? stage.source : undefined;
		}
		return extracted.length > 0 ? stage.source : undefined;
	}

	return undefined;
};

const parentScope = (stage: WebRobotStage, parent: WebRobotStageRecord | undefined): TemplateScope => {
	if (!parent) {
		return {};
	}
	return {
		record: parent.data,
		[parent.stageId]: parent.data,
		...(stage.forEach ? { [stage.forEach.from]: parent.data } : {}),
	};
};

const recordUrl = (data: Record<string, unknown>, loaded: WebRobotLoadedSource): string => {
	const candidate = data.url ?? data.canonical_url ?? data.uri;
	if (typeof candidate === 'string' && candidate) {
		try {
			return canonicalHttpUrl(candidate, loaded.finalUrl);
		} catch {
			return loaded.finalUrl;
		}
	}
	return loaded.finalUrl;
};

const renderSourceUrl = (source: WebRobotSource, scope: TemplateScope): string => {
	return canonicalHttpUrl(renderStringTemplate(source.url, scope));
};

const createContext = (recipe: WebRobotRecipe, options: WebRobotExecutionOptions): RunnerContext => ({
	recipe,
	env: options.env ?? {},
	signal: options.signal,
	stats: emptyWebRobotRunStats(),
	events: [],
	onEvent: options.onEvent,
	startedAt: Date.now(),
	robots: new RobotsTxtPolicy(fetchRobotsTxt),
	browser: new WebRobotBrowserSession(),
});

const fetchRobotsTxt = async (robotsUrl: string): Promise<string | null> => {
	const response = await fetch(robotsUrl, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
	if (response.status >= 400) {
		return null;
	}
	return readResponseWithLimit(response, 256 * 1024);
};

const dryRunRecipe = (recipe: WebRobotRecipe): WebRobotRecipe => ({
	...recipe,
	limits: {
		...recipe.limits,
		maxPages: Math.min(recipe.limits.maxPages, 3),
		maxItems: Math.min(recipe.limits.maxItems, 10),
		maxRequests: Math.min(recipe.limits.maxRequests, 250),
		maxDurationMs: Math.min(recipe.limits.maxDurationMs, 2 * 60_000),
		maxResponseBytes: Math.min(recipe.limits.maxResponseBytes, 2 * 1024 * 1024),
	},
});

const assertLimits = (context: RunnerContext): void => {
	if (context.stats.pagesFetched > context.recipe.limits.maxPages) {
		throw new Error(`Web robot exceeded the ${context.recipe.limits.maxPages} page limit`);
	}
	if (context.stats.itemsExtracted > context.recipe.limits.maxItems) {
		throw new Error(`Web robot exceeded the ${context.recipe.limits.maxItems} item limit`);
	}
	if (context.stats.requests > context.recipe.limits.maxRequests) {
		throw new Error(`Web robot exceeded the ${context.recipe.limits.maxRequests} request limit`);
	}
	if (Date.now() - context.startedAt > context.recipe.limits.maxDurationMs) {
		throw new Error(`Web robot exceeded the ${context.recipe.limits.maxDurationMs} ms duration limit`);
	}
};

const delayBetweenRequests = async (context: RunnerContext, factor = 1): Promise<void> => {
	const delayMs = context.recipe.request.delayMs * factor;
	if (delayMs <= 0) {
		return;
	}
	await new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, delayMs);
		context.signal?.addEventListener('abort', () => {
			clearTimeout(timer);
			reject(new Error('Web robot run was cancelled'));
		});
	});
};

const throwIfStopped = (context: RunnerContext): void => {
	if (context.signal?.aborted) {
		throw new Error('Web robot run was cancelled');
	}
	assertLimits(context);
};

const recordError = async (
	context: RunnerContext,
	url: string,
	error: unknown,
	kind: 'request' | 'extract',
): Promise<void> => {
	if (kind === 'request') {
		context.stats.failedRequests += 1;
	} else {
		context.stats.extractionErrors += 1;
	}
	const message = error instanceof Error ? error.message : String(error);
	if (context.stats.errors.length < 100) {
		context.stats.errors.push(message);
	}
	await emit(context, { type: 'error', url, message, createdAt: now() });
};

const emit = async (context: RunnerContext, event: WebRobotRunEvent): Promise<void> => {
	context.events.push(event);
	await context.onEvent?.(event);
};

const parseJson = (bodyText?: string): unknown => {
	if (!bodyText) {
		return undefined;
	}
	try {
		return JSON.parse(bodyText);
	} catch {
		return undefined;
	}
};

const now = (): string => new Date().toISOString();
