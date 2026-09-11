import {
	emptyWebRobotRunStats,
	type WebRobotExtract,
	type WebRobotRecipe,
	type WebRobotRunStats,
	type WebRobotSource,
	type WebRobotStage,
} from '@nao/shared/web-robot';

import { detectLoadedSourceBlockers } from './blockers';
import { WebRobotBrowserSession } from './browser-loader';
import { extractDomRecords, findNextLink } from './extract-dom';
import { extractEmbeddedRecords } from './extract-embedded';
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
	WebRobotRunWarning,
	WebRobotStageRecord,
} from './types';
import { assertPublicHttpUrl, canonicalHttpUrl } from './url-policy';

const DRY_RUN_PARENT_LIMIT = 3;
const DRY_RUN_STAGE_PAGE_LIMIT = 3;

type RunnerContext = {
	recipe: WebRobotRecipe;
	env: Record<string, string>;
	signal?: AbortSignal;
	dryRun: boolean;
	stats: WebRobotRunStats;
	events: WebRobotRunEvent[];
	warningKeys: Set<string>;
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
	context.stats.fieldCoverage = productFieldCoverage(normalized.products);
	await emitWarnings(context, 'run', fieldCoverageWarnings(context.stats.fieldCoverage, recipe));
	return { stats: context.stats, stageRecords, products: normalized.products, events: context.events, normalized };
};

const runStage = async (
	stage: WebRobotStage,
	context: RunnerContext,
	stageRecords: Map<string, WebRobotStageRecord[]>,
): Promise<WebRobotStageRecord[]> => {
	const parentLimit = stage.forEach
		? context.dryRun
			? Math.min(stage.forEach.limit ?? DRY_RUN_PARENT_LIMIT, DRY_RUN_PARENT_LIMIT)
			: stage.forEach.limit
		: undefined;
	const parents = stage.forEach ? (stageRecords.get(stage.forEach.from) ?? []).slice(0, parentLimit) : [undefined];
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
	let paginationValue = initialPaginationValue(stage.paginate);
	const stageMaxPages = stage.paginate?.maxPages ?? 1;
	const maxPages = context.dryRun ? Math.min(stageMaxPages, DRY_RUN_STAGE_PAGE_LIMIT) : stageMaxPages;

	if (stage.paginate?.type === 'click' || stage.paginate?.type === 'scroll') {
		if (stage.source.type !== 'browser') {
			throw new Error('Click and scroll pagination require a browser source');
		}
		const warnings: WebRobotRunWarning[] = [];
		const pages = await loadInteractivePaginatedSource(
			stage.source,
			scope,
			context,
			{
				...stage.paginate,
				maxPages,
			},
			(warning) => warnings.push(warning),
		);
		await emitWarnings(context, stage.id, warnings);
		for (const [index, loaded] of pages.entries()) {
			throwIfStopped(context);
			await collectLoaded(stage, parent, loaded, context, records);
			if (index < pages.length - 1) {
				await delayBetweenRequests(context);
			}
		}
		return;
	}

	const linkPagination = stage.paginate?.type === 'nextLink' || stage.paginate?.type === 'nextPath';
	const expectsHtml =
		stage.extract?.type === 'dom' || stage.extract?.type === 'embedded' || stage.extract?.type === 'jsonld';
	let nextSource: WebRobotSource | undefined = stage.source;
	const visitedUrls = new Set<string>();
	let pageCount = 0;
	while (nextSource && pageCount < maxPages) {
		throwIfStopped(context);
		const pageScope = { ...scope, ...paginationScope(stage.paginate, paginationValue) };
		const loaded = await loadSource(nextSource, pageScope, context);
		visitedUrls.add(visitedUrlKey(loaded.finalUrl));
		if (linkPagination && expectsHtml && isNonHtmlContent(loaded.contentType)) {
			await emitWarnings(context, stage.id, [
				{
					kind: 'pagination_stopped',
					message: `Stopped paginating: '${loaded.finalUrl}' returned non-HTML content ('${loaded.contentType}').`,
				},
			]);
			break;
		}
		const extracted = await collectLoaded(stage, parent, loaded, context, records);

		pageCount += 1;
		const warnings: WebRobotRunWarning[] = [];
		const next = nextPageSource(stage, loaded, extracted, paginationValue, (warning) => warnings.push(warning));
		await emitWarnings(context, stage.id, warnings);
		nextSource = next?.source;
		if (nextSource && linkPagination && visitedUrls.has(visitedUrlKey(nextSource.url))) {
			await emitWarnings(context, stage.id, [
				{
					kind: 'pagination_stopped',
					message: `Stopped paginating: next page '${nextSource.url}' was already visited.`,
				},
			]);
			nextSource = undefined;
		}
		if (nextSource && next) {
			paginationValue = next.value;
			await delayBetweenRequests(context);
		}
	}
};

const visitedUrlKey = (url: string): string => {
	try {
		return canonicalHttpUrl(url);
	} catch {
		return url;
	}
};

const isNonHtmlContent = (contentType?: string): boolean => {
	if (!contentType) {
		return false;
	}
	const type = contentType.toLowerCase();
	return !type.includes('html') && !type.startsWith('text/plain');
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
	await trackLoaded(context, loaded);
	return loaded;
};

const loadInteractivePaginatedSource = async (
	source: Extract<WebRobotSource, { type: 'browser' }>,
	scope: TemplateScope,
	context: RunnerContext,
	pagination: Extract<NonNullable<WebRobotStage['paginate']>, { type: 'click' | 'scroll' }>,
	onWarning: (warning: WebRobotRunWarning) => void,
): Promise<WebRobotLoadedSource[]> => {
	const renderedUrl = renderSourceUrl(source, scope);
	await assertPublicHttpUrl(renderedUrl, context.recipe.allowedHosts);
	if (context.recipe.respectRobotsTxt) {
		await context.robots.assertAllowed(renderedUrl, context.recipe.request.userAgent);
	}
	const pages = await context.browser.loadPaginated(
		source,
		{
			recipe: context.recipe,
			scope,
			env: context.env,
			signal: context.signal,
			onWarning,
		},
		pagination,
	);
	for (const loaded of pages) {
		await trackLoaded(context, loaded);
	}
	return pages;
};

const trackLoaded = async (context: RunnerContext, loaded: WebRobotLoadedSource): Promise<void> => {
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
};

const collectLoaded = async (
	stage: WebRobotStage,
	parent: WebRobotStageRecord | undefined,
	loaded: WebRobotLoadedSource,
	context: RunnerContext,
	records: WebRobotStageRecord[],
): Promise<Record<string, unknown>[]> => {
	const warnings: WebRobotRunWarning[] = [];
	const extracted = extractLoaded(loaded, stage.extract, context, (warning) => warnings.push(warning));
	await emitWarnings(context, stage.id, warnings);
	await emitWarnings(
		context,
		stage.id,
		detectLoadedSourceBlockers(
			loaded,
			stage.source.type === 'browser' ? 'browser' : 'http',
			extracted.length > 0,
		).map((blocker) => ({
			kind: 'blocker_detected' as const,
			blocker: blocker.kind,
			message: blocker.message,
			data: { evidence: blocker.evidence, status: blocker.status },
		})),
	);
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
	return extracted;
};

const extractLoaded = (
	loaded: WebRobotLoadedSource,
	extract: WebRobotExtract | undefined,
	context: RunnerContext,
	onWarning: (warning: WebRobotRunWarning) => void,
): Record<string, unknown>[] => {
	if (!extract) {
		return [{ url: loaded.finalUrl, status: loaded.status }];
	}

	try {
		switch (extract.type) {
			case 'dom':
				return extractDomRecords(loaded.bodyText ?? '', extract, loaded.finalUrl, onWarning);
			case 'json':
				return extractJsonRecords(loaded.bodyJson ?? parseJson(loaded.bodyText), extract, loaded.finalUrl);
			case 'network':
				return loaded.captures
					.filter((capture) => capture.name === extract.capture)
					.flatMap((capture) => extractJsonRecords(capture.body, extract, loaded.finalUrl));
			case 'embedded':
				return extractEmbeddedRecords(loaded.bodyText ?? '', extract, loaded.finalUrl);
			case 'jsonld':
				return extractJsonLdRecords(loaded.bodyText ?? '', extract, loaded.finalUrl);
		}
	} catch (error) {
		void recordError(context, loaded.finalUrl, error, 'extract');
		return [];
	}
};

const initialPaginationValue = (pagination: WebRobotStage['paginate']): unknown => {
	if (pagination?.type === 'page') {
		return pagination.firstPage;
	}
	if (pagination?.type === 'cursor') {
		return pagination.firstCursor ?? '';
	}
	if (pagination?.type === 'offset') {
		return pagination.firstOffset;
	}
	return 1;
};

const paginationScope = (pagination: WebRobotStage['paginate'], value: unknown): TemplateScope => {
	if (pagination?.type === 'page') {
		return { [pagination.pageVariable]: value };
	}
	if (pagination?.type === 'cursor') {
		return { [pagination.cursorVariable]: value };
	}
	if (pagination?.type === 'offset') {
		return { [pagination.offsetVariable]: value };
	}
	return {};
};

const nextPageSource = (
	stage: WebRobotStage,
	loaded: WebRobotLoadedSource,
	extracted: Record<string, unknown>[],
	paginationValue: unknown,
	onWarning: (warning: WebRobotRunWarning) => void,
): { source: WebRobotSource; value: unknown } | undefined => {
	const pagination = stage.paginate;
	if (!pagination) {
		return undefined;
	}

	if (pagination.type === 'nextLink') {
		const href = loaded.bodyText
			? findNextLink(
					loaded.bodyText,
					pagination.selector,
					pagination.attr,
					loaded.finalUrl,
					pagination.selectors,
					pagination.fingerprint,
					onWarning,
				)
			: null;
		return href ? { source: { ...stage.source, url: href } as WebRobotSource, value: paginationValue } : undefined;
	}

	if (pagination.type === 'nextPath') {
		const next = getPathValue(loaded.bodyJson ?? parseJson(loaded.bodyText), pagination.path);
		return typeof next === 'string' && next
			? {
					source: { ...stage.source, url: new URL(next, loaded.finalUrl).toString() } as WebRobotSource,
					value: paginationValue,
				}
			: undefined;
	}

	if (pagination.type === 'cursor') {
		const next = getPathValue(loaded.bodyJson ?? parseJson(loaded.bodyText), pagination.nextCursorPath);
		return (typeof next === 'string' || typeof next === 'number') && String(next) !== ''
			? { source: stage.source, value: String(next) }
			: undefined;
	}

	if (pagination.type === 'offset') {
		const nextOffset = Number(paginationValue) + pagination.pageSize;
		const total = pagination.totalPath
			? Number(getPathValue(loaded.bodyJson ?? parseJson(loaded.bodyText), pagination.totalPath))
			: undefined;
		if (extracted.length === 0 || !Number.isFinite(nextOffset) || nextOffset < 0) {
			return undefined;
		}
		return total === undefined || !Number.isFinite(total) || nextOffset < total
			? { source: stage.source, value: nextOffset }
			: undefined;
	}

	if (pagination.type === 'page') {
		const nextPage = Number(paginationValue) + 1;
		if (pagination.totalPagesPath) {
			const totalPages = Number(
				getPathValue(loaded.bodyJson ?? parseJson(loaded.bodyText), pagination.totalPagesPath),
			);
			return Number.isFinite(totalPages) && nextPage <= totalPages
				? { source: stage.source, value: nextPage }
				: undefined;
		}
		return extracted.length > 0 ? { source: stage.source, value: nextPage } : undefined;
	}

	return undefined;
};

const COVERAGE_FIELDS: Record<string, string[]> = {
	name: ['name'],
	url: ['source_url', 'canonical_url', 'url'],
	sku: ['sku'],
	price: ['price'],
	description: ['description'],
	image_url: ['image_urls_json', 'images', 'image_url'],
	brand: ['brand'],
	categories: ['categories_json', 'categories'],
};

const productFieldCoverage = (products: Record<string, unknown>[]): Record<string, number> => {
	if (!products.length) {
		return {};
	}
	return Object.fromEntries(
		Object.entries(COVERAGE_FIELDS).map(([field, keys]) => {
			const count = products.filter((product) => keys.some((key) => hasCoverageValue(product[key]))).length;
			return [field, Math.round((count / products.length) * 100)];
		}),
	);
};

const hasCoverageValue = (value: unknown): boolean => {
	return (
		value !== undefined &&
		value !== null &&
		value !== '' &&
		value !== '[]' &&
		value !== '{}' &&
		(!Array.isArray(value) || value.length > 0)
	);
};

const fieldCoverageWarnings = (coverage: Record<string, number>, recipe: WebRobotRecipe): WebRobotRunWarning[] => {
	const extractedFields = new Set(
		recipe.stages
			.filter((stage) => stage.output === 'product' && stage.extract)
			.flatMap((stage) => Object.keys(stage.extract!.fields)),
	);
	const warnings: WebRobotRunWarning[] = [];
	for (const [field, threshold] of [
		['url', 80],
		['name', 80],
		['sku', 50],
	] as const) {
		const value = coverage[field];
		if (value !== undefined && extractedFields.has(field) && value < threshold) {
			warnings.push({
				kind: 'field_coverage_drop',
				field,
				message: `Field '${field}' coverage is ${value}%, below the ${threshold}% threshold.`,
				data: { coverage: value, threshold },
			});
		}
	}
	return warnings;
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
	dryRun: options.dryRun === true,
	stats: emptyWebRobotRunStats(),
	events: [],
	warningKeys: new Set(),
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
		maxPages: Math.min(recipe.limits.maxPages, 10),
		maxItems: Math.min(recipe.limits.maxItems, 50),
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

const emitWarnings = async (context: RunnerContext, stageId: string, warnings: WebRobotRunWarning[]): Promise<void> => {
	for (const warning of warnings) {
		const key = [stageId, warning.kind, warning.blocker, warning.field, warning.selector, warning.fallback].join(
			':',
		);
		if (context.warningKeys.has(key)) {
			continue;
		}
		context.warningKeys.add(key);
		context.stats.warnings ??= [];
		if (context.stats.warnings.length < 100) {
			context.stats.warnings.push(warning.message);
		}
		await emit(context, {
			type: 'warning',
			stageId,
			message: warning.message,
			data: warning,
			createdAt: now(),
		});
	}
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
