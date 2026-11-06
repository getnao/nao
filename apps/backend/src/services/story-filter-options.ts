import { createHash } from 'node:crypto';

import { quoteSqlString, renderFilterSqlValue, type StoryFilterSelection } from '@nao/shared/sql-template';
import { resolveSemanticQueryParameters } from '@nao/shared/story-parameter-template';
import { getStoryFiltersFromCode, type ParsedFilterBlock } from '@nao/shared/story-segments';
import { LOCAL_DATABASE_ID } from '@nao/shared/tools';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import type { DBStory } from '../db/abstractSchema';
import type { StoredSqlQuery } from '../queries/execute-sql.queries';
import * as storyQueries from '../queries/story.queries';
import * as filterOptionsCacheQueries from '../queries/story-filter-options-cache.queries';
import { logger } from '../utils/logger';
import { assertSafeSqlIdentifier } from '../utils/sql-identifiers';
import { createStoryExecutionContext, executeRawSql, isCacheExpired, type StoryExecutionContext } from './live-story';
import { compileSemanticQuery, describeSemanticLayerCached, type SemanticQuery } from './semantic-layer.service';
import { canFilterMetrics, dimensionExpression } from './semantic-story-bindings';

const FILTER_OPTIONS_LIMIT = 100;
const FILTER_OPTIONS_MAX_AGE_MS = 60 * 60 * 1000;
const FILTER_OPTIONS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PARENT_FILTER_TYPES = new Set<ParsedFilterBlock['filterType']>(['select', 'multi_select', 'text']);
const DIMENSION_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
const STRING_CAST_TYPE_BY_DIALECT: Record<string, string> = {
	bigquery: 'STRING',
	databricks: 'STRING',
	spark: 'STRING',
	hive: 'STRING',
	mysql: 'CHAR',
};

const pendingRefreshes = new Map<string, Promise<FilterOptionsResult>>();

export const filterOptionsRequestSchema = z.object({
	search: z.string().max(200).optional(),
	parentSelection: z.union([z.string(), z.array(z.string())]).optional(),
});

export type FilterOptionsRequest = z.infer<typeof filterOptionsRequestSchema>;

export interface FilterOptionsResult {
	options: string[];
	/** False when the list was truncated at the limit, so the client must search on the server. */
	isComplete: boolean;
}

interface FilterOptionsExecutionOptions {
	billingAccessVerifiedProjectId?: string;
}

interface StoryFilterContext {
	chatId: string;
	story: DBStory;
	filters: ParsedFilterBlock[];
	sqlQueries: Record<string, StoredSqlQuery>;
}

type FilterOptionsSource = WarehouseOptionsSource | SemanticOptionsSource;

interface WarehouseOptionsSource {
	kind: 'warehouse';
	table: string;
	column: string;
	databaseId?: string;
	dialect?: string;
	parentCondition: string | null;
}

interface SemanticOptionsSource {
	kind: 'semantic';
	dimension: string;
	/** Explicit `metric` from the filter tag; null picks a story metric that supports the dimension. */
	metric: string | null;
	parentCondition: string | null;
}

export async function getStoryFilterOptions(
	chatId: string,
	storySlug: string,
	filterId: string,
	request: FilterOptionsRequest = {},
	executionOptions: FilterOptionsExecutionOptions = {},
): Promise<FilterOptionsResult> {
	const context = await loadStoryFilterContext(chatId, storySlug);
	const filter = context.filters.find((candidate) => candidate.id === filterId);
	if (!filter) {
		throw new TRPCError({ code: 'NOT_FOUND', message: `Filter "${filterId}" not found in story.` });
	}

	if (filter.options?.length) {
		return { options: [...new Set(filter.options)], isComplete: true };
	}

	const source = buildOptionsSource(filter, context, request.parentSelection);
	const search = normalizeSearchTerm(request.search);
	if (search) {
		const executionContext = await createStoryExecutionContext(chatId);
		return queryFilterOptions(context, filter.id, source, executionContext, executionOptions, search);
	}

	return getCachedFilterOptions(context, filter.id, source, executionOptions);
}

/** Precomputes option lists of filters without a parent so the first visitor after a refresh doesn't wait. */
export async function warmStoryFilterOptions(
	chatId: string,
	storySlug: string,
	executionOptions: FilterOptionsExecutionOptions = {},
): Promise<void> {
	const context = await loadStoryFilterContext(chatId, storySlug);
	const topLevelFilters = context.filters.filter(
		(filter) => !filter.options?.length && hasRemoteOptions(filter) && !filter.dependsOn,
	);

	for (const filter of topLevelFilters) {
		await refreshFilterOptions(context, filter.id, buildOptionsSource(filter, context), executionOptions).catch(
			(error) => logFilterOptionsError(context, filter.id, error),
		);
	}

	const retentionCutoff = new Date(Date.now() - FILTER_OPTIONS_RETENTION_MS);
	await filterOptionsCacheQueries.deleteFilterOptionsCacheOlderThan(context.story.id, retentionCutoff);
}

/** Serves cached options immediately and refreshes stale entries in the background (stale-while-revalidate). */
async function getCachedFilterOptions(
	context: StoryFilterContext,
	filterId: string,
	source: FilterOptionsSource,
	executionOptions: FilterOptionsExecutionOptions,
): Promise<FilterOptionsResult> {
	const cached = await filterOptionsCacheQueries.getFilterOptionsCache(context.story.id, buildCacheKey(source));
	if (!cached) {
		return refreshFilterOptions(context, filterId, source, executionOptions);
	}

	if (isFilterOptionsCacheStale(cached.cachedAt, context.story.cacheSchedule)) {
		refreshFilterOptions(context, filterId, source, executionOptions).catch((error) =>
			logFilterOptionsError(context, filterId, error),
		);
	}
	return { options: cached.options, isComplete: cached.isComplete };
}

/**
 * Deduplicates concurrent refreshes within this pod. Pods share the cache through the app database,
 * so a refresh racing on another pod only costs one extra warehouse query and an idempotent upsert.
 */
function refreshFilterOptions(
	context: StoryFilterContext,
	filterId: string,
	source: FilterOptionsSource,
	executionOptions: FilterOptionsExecutionOptions,
): Promise<FilterOptionsResult> {
	const cacheKey = buildCacheKey(source);
	const pendingKey = `${context.story.id}:${cacheKey}`;
	const pending = pendingRefreshes.get(pendingKey);
	if (pending) {
		return pending;
	}

	const refresh = queryAndCacheFilterOptions(context, filterId, source, cacheKey, executionOptions).finally(() =>
		pendingRefreshes.delete(pendingKey),
	);
	pendingRefreshes.set(pendingKey, refresh);
	return refresh;
}

async function queryAndCacheFilterOptions(
	context: StoryFilterContext,
	filterId: string,
	source: FilterOptionsSource,
	cacheKey: string,
	executionOptions: FilterOptionsExecutionOptions,
): Promise<FilterOptionsResult> {
	const executionContext = await createStoryExecutionContext(context.chatId);
	const result = await queryFilterOptions(context, filterId, source, executionContext, executionOptions);
	await filterOptionsCacheQueries.upsertFilterOptionsCache(
		context.story.id,
		cacheKey,
		result.options,
		result.isComplete,
	);
	return result;
}

async function queryFilterOptions(
	context: StoryFilterContext,
	filterId: string,
	source: FilterOptionsSource,
	executionContext: StoryExecutionContext,
	executionOptions: FilterOptionsExecutionOptions,
	search?: string,
): Promise<FilterOptionsResult> {
	const rawValues =
		source.kind === 'warehouse'
			? await fetchWarehouseOptionValues(source, executionContext, executionOptions, search)
			: await fetchDimensionValues(context, filterId, source, executionContext, executionOptions, search);
	const values = [...new Set(rawValues.filter((value) => value !== null))];

	return {
		options: values.slice(0, FILTER_OPTIONS_LIMIT).sort((a, b) => a.localeCompare(b)),
		isComplete: values.length <= FILTER_OPTIONS_LIMIT,
	};
}

async function fetchWarehouseOptionValues(
	source: WarehouseOptionsSource,
	executionContext: StoryExecutionContext,
	executionOptions: FilterOptionsExecutionOptions,
	search?: string,
): Promise<Array<string | null>> {
	const result = await executeRawSql(buildOptionsSql(source, search), {
		executionContext,
		databaseId: source.databaseId,
		billingAccessVerifiedProjectId: executionOptions.billingAccessVerifiedProjectId,
	});
	return result.data.map((row) => readOptionValue(row, 'value'));
}

/** Lists a dimension's values through the semantic layer, grouped by a metric that supports it. */
async function fetchDimensionValues(
	context: StoryFilterContext,
	filterId: string,
	source: SemanticOptionsSource,
	executionContext: StoryExecutionContext,
	executionOptions: FilterOptionsExecutionOptions,
	search?: string,
): Promise<Array<string | null>> {
	const metric =
		source.metric ?? (await pickMetricForDimension(context, filterId, source.dimension, executionContext));
	const compiled = await compileSemanticQuery(
		buildDimensionValuesQuery(source, metric, search),
		executionContext.toolContext,
	);
	const result = await executeRawSql(compiled.sql, {
		executionContext,
		databaseId: compiled.database_id,
		billingAccessVerifiedProjectId: executionOptions.billingAccessVerifiedProjectId,
	});
	return result.data.map((row) => readOptionValue(row, source.dimension));
}

function buildDimensionValuesQuery(source: SemanticOptionsSource, metric: string, search?: string): SemanticQuery {
	const where = [
		...(source.parentCondition ? [source.parentCondition] : []),
		...(search ? [`LOWER(${dimensionExpression(source.dimension)}) LIKE ${quoteSqlString(`%${search}%`)}`] : []),
	];
	return {
		metrics: [metric],
		group_by: [source.dimension],
		order_by: [source.dimension],
		limit: FILTER_OPTIONS_LIMIT + 1,
		...(where.length > 0 && { where }),
	};
}

async function pickMetricForDimension(
	context: StoryFilterContext,
	filterId: string,
	dimension: string,
	executionContext: StoryExecutionContext,
): Promise<string> {
	const metrics = listStorySemanticMetrics(context.sqlQueries);
	if (metrics.length === 0) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `Filter "${filterId}" is bound to dimension "${dimension}" but the story has no semantic-layer query to list its values. Set metric="<metric>" on the filter.`,
		});
	}
	const catalog = await describeSemanticLayerCached(executionContext.toolContext).catch(() => null);
	return metrics.find((metric) => canFilterMetrics(catalog, [metric], dimension)) ?? metrics[0];
}

function listStorySemanticMetrics(sqlQueries: Record<string, StoredSqlQuery>): string[] {
	const metrics = Object.values(sqlQueries).flatMap((query) => {
		if (!query.semanticQuery) {
			return [];
		}
		try {
			return resolveSemanticQueryParameters(query.semanticQuery).metrics;
		} catch {
			return [];
		}
	});
	return [...new Set(metrics)];
}

function buildOptionsSql(source: WarehouseOptionsSource, search?: string): string {
	const conditions = [`${source.column} IS NOT NULL`];
	if (source.parentCondition) {
		conditions.push(source.parentCondition);
	}
	if (search) {
		const castType = STRING_CAST_TYPE_BY_DIALECT[source.dialect ?? ''] ?? 'VARCHAR';
		conditions.push(`LOWER(CAST(${source.column} AS ${castType})) LIKE ${quoteSqlString(`%${search}%`)}`);
	}

	return `SELECT DISTINCT ${source.column} AS value FROM ${source.table} WHERE ${conditions.join(' AND ')} ORDER BY ${source.column} LIMIT ${FILTER_OPTIONS_LIMIT + 1}`;
}

function buildOptionsSource(
	filter: ParsedFilterBlock,
	context: StoryFilterContext,
	parentSelection?: StoryFilterSelection,
): FilterOptionsSource {
	if (filter.table && filter.column) {
		const databaseId = filter.databaseId ?? findDefaultDatabaseId(context.sqlQueries);
		return {
			kind: 'warehouse',
			table: assertSafeSqlIdentifier(filter.table, 'table'),
			column: assertSafeSqlIdentifier(filter.column, 'column'),
			databaseId,
			dialect: findDialect(context.sqlQueries, databaseId),
			parentCondition: buildParentCondition(filter, context.filters, parentSelection, 'warehouse'),
		};
	}

	if (filter.dimension && DIMENSION_NAME_REGEX.test(filter.dimension)) {
		return {
			kind: 'semantic',
			dimension: filter.dimension,
			metric: filter.metric ?? null,
			parentCondition: buildParentCondition(filter, context.filters, parentSelection, 'semantic'),
		};
	}

	throw new TRPCError({
		code: 'BAD_REQUEST',
		message: `Filter "${filter.id}" has no hardcoded options, table/column or semantic layer dimension.`,
	});
}

function buildParentCondition(
	filter: ParsedFilterBlock,
	filters: ParsedFilterBlock[],
	parentSelection: StoryFilterSelection | undefined,
	kind: FilterOptionsSource['kind'],
): string | null {
	const parent = filters.find((candidate) => candidate.id === filter.dependsOn);
	if (!parent || !PARENT_FILTER_TYPES.has(parent.filterType) || parentSelection === undefined) {
		return null;
	}
	const target = parentTargetExpression(parent, kind);
	if (!target) {
		return null;
	}

	const stableSelection = Array.isArray(parentSelection) ? [...parentSelection].sort() : parentSelection;
	const values = renderFilterSqlValue(parent.filterType, stableSelection, parent.valueType);
	return values === null ? null : `${target} IN (${values})`;
}

function parentTargetExpression(parent: ParsedFilterBlock, kind: FilterOptionsSource['kind']): string | null {
	if (kind === 'warehouse') {
		return parent.column ? assertSafeSqlIdentifier(parent.column, 'column') : null;
	}
	return parent.dimension && DIMENSION_NAME_REGEX.test(parent.dimension)
		? dimensionExpression(parent.dimension)
		: null;
}

function hasRemoteOptions(filter: ParsedFilterBlock): boolean {
	return Boolean((filter.table && filter.column) || filter.dimension);
}

async function loadStoryFilterContext(chatId: string, storySlug: string): Promise<StoryFilterContext> {
	const [story, version] = await Promise.all([
		storyQueries.getStoryByChatAndSlug(chatId, storySlug),
		storyQueries.getLatestVersionByChatAndSlug(chatId, storySlug),
	]);
	if (!story || !version) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
	}

	return {
		chatId,
		story,
		filters: getStoryFiltersFromCode(version.code),
		sqlQueries: await storyQueries.getSqlQueriesFromCode(chatId, version.code),
	};
}

function isFilterOptionsCacheStale(cachedAt: Date, cacheSchedule: string | null): boolean {
	return Date.now() - cachedAt.getTime() > FILTER_OPTIONS_MAX_AGE_MS || isCacheExpired(cachedAt, cacheSchedule);
}

function buildCacheKey(source: FilterOptionsSource): string {
	return createHash('sha256').update(JSON.stringify(source)).digest('hex');
}

/** Wildcards are stripped rather than escaped because LIKE escape syntax differs between warehouses. */
function normalizeSearchTerm(search: string | undefined): string {
	return (search ?? '')
		.trim()
		.toLowerCase()
		.replace(/[%_\\]/g, '');
}

function findDefaultDatabaseId(sqlQueries: Record<string, StoredSqlQuery>): string | undefined {
	const databaseIds = Object.values(sqlQueries).flatMap((query) => (query.databaseId ? [query.databaseId] : []));
	return databaseIds.find((id) => id !== LOCAL_DATABASE_ID) ?? databaseIds[0];
}

function findDialect(sqlQueries: Record<string, StoredSqlQuery>, databaseId: string | undefined): string | undefined {
	return Object.values(sqlQueries).find((query) => query.databaseId === databaseId && query.dialect)?.dialect;
}

/** Column names are matched case-insensitively because some warehouses upper-case unquoted aliases. */
function readOptionValue(row: unknown, column: string): string | null {
	if (!row || typeof row !== 'object') {
		return null;
	}
	const record = row as Record<string, unknown>;
	const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === column.toLowerCase());
	const value = key === undefined ? undefined : record[key];
	if (value === null || value === undefined) {
		return null;
	}
	const text = String(value);
	return text.trim() === '' ? null : text;
}

function logFilterOptionsError(context: StoryFilterContext, filterId: string, error: unknown) {
	logger.warn(`Failed to refresh story filter options for "${filterId}": ${String(error)}`, {
		source: 'system',
		projectId: context.story.projectId ?? undefined,
		context: { storyId: context.story.id },
	});
}
