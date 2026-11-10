import { createHash } from 'node:crypto';

import { stripSqlFilterBlocks } from '@nao/shared/sql-template';
import type { StoryNarratives } from '@nao/shared/story-app';
import { extractQueryIds, TAG_ATTRS } from '@nao/shared/story-segments';
import { formatColumnLabel } from '@nao/shared/story-table-utils';
import { LOCAL_DATABASE_ID } from '@nao/shared/tools';
import type { StoryFormat } from '@nao/shared/types';
import { generateText, Output } from 'ai';
import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod';

import { llmTelemetry } from '../agents/telemetry';
import { queryAppDb } from '../agents/tools/query-app-db';
import { LiveCustomStoryNarrativesPrompt, LiveStoryRefreshPrompt } from '../components/ai/live-story-refresh-prompt';
import type { DBStoryDataCache } from '../db/abstractSchema';
import { renderToMarkdown } from '../lib/markdown';
import * as chatQueries from '../queries/chat.queries';
import * as executeSqlQueries from '../queries/execute-sql.queries';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import { getQueryDataFromCode } from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyFileQueries from '../queries/story-file.queries';
import * as userGroupQueries from '../queries/user-group.queries';
import type { StoryQuerySources } from '../types/story-cache';
import type { QueryResult, ToolContext } from '../types/tools';
import { convertToTokenUsage } from '../utils/ai';
import { getDefaultModelId, resolveDefaultModelSelection, resolveProviderModel } from '../utils/llm';
import { scheduleSaveLlmInferenceRecord } from '../utils/schedule-task';
import { referencedQueryIds } from '../utils/sql-file-paths';
import type { StoryNarrativeSource } from '../utils/story-kit-narratives';
import { extractStoryNarratives } from '../utils/story-kit-narratives';
import { backfillMissingQueryData, extractCustomStoryQueryIds, findMissingQueryIds } from '../utils/story-query-data';
import { buildToolContext, MAX_OUTPUT_TOKENS } from './agent';
import { assertProjectCloudBillingAccess } from './cloud-billing-access.service';
import { resolveExcludedColumnEnforcement } from './excluded-columns.service';
import { runQueryOnLocalFiles } from './local-query.service';
import { compileSemanticQuery, describeSemanticLayerCached, type SemanticQuery } from './semantic-layer.service';
import {
	bindSemanticQuery,
	type CatalogLoader,
	semanticBindingsFromCode,
	type SemanticStoryBindings,
} from './semantic-story-bindings';
import { hasEffectiveRowSecurityRestrictions } from './user-group-context-access.service';
import { executeWarehouseSql, validateWarehouseSql } from './warehouse-sql.service';

const MAX_RENDERED_ROWS = 60;

interface StoryRefreshTarget {
	projectId: string;
	userId: string;
	chatId: string;
}

export type StorySqlQuery = {
	sqlQuery: string;
	databaseId?: string;
	adminMode: boolean;
	semanticQuery?: SemanticQuery;
};
export type StorySqlQueries = Record<string, StorySqlQuery>;
export type StoryQueryData = Record<string, StoryQueryResult>;

export interface StoryQueryResult {
	data: unknown[];
	columns: string[];
	/** Story filters not applied to this semantic-layer query because its metrics lack their dimension. */
	skippedFilterIds?: string[];
}

export async function executeLiveQuery(
	chatId: string,
	queryId: string,
	options: LiveQueryOptions = {},
): Promise<{ data: unknown[]; columns: string[] }> {
	const query = await storyQueries.getSqlQueryById(chatId, queryId);
	if (!query) {
		throw new Error(`Query ${queryId} not found in chat ${chatId}`);
	}

	const viewerUserId =
		options.viewerUserId && (await hasRowSecurity(chatId, options.viewerUserId)) ? options.viewerUserId : undefined;
	const executionContext = viewerUserId ? await createStoryExecutionContext(chatId, viewerUserId) : undefined;

	const queryData = await executeStoryQueries(
		chatId,
		{ [queryId]: query },
		{
			renderSql: stripSqlFilterBlocks,
			semanticBindings: options.storyCode ? semanticBindingsFromCode(options.storyCode) : undefined,
			billingAccessVerifiedProjectId: options.billingAccessVerifiedProjectId,
			executionContext,
		},
	);
	return queryData[queryId]!;
}

export interface RefreshResult {
	queryData: StoryQueryData;
	narratives: StoryNarratives;
}

interface StoryRefreshOptions {
	billingAccessVerifiedProjectId?: string;
	generateViewerCode?: boolean;
	storyVersionId?: string;
	viewerUserId?: string;
}

interface LiveQueryOptions extends StoryRefreshOptions {
	/** The story displaying the query, so its parameter defaults apply to semantic-layer queries. */
	storyCode?: string;
}

export async function refreshStoryData(
	chatId: string,
	slug: string,
	options: StoryRefreshOptions = {},
): Promise<RefreshResult> {
	const { queryData, narratives } = await refreshStoryDataWithContext(chatId, slug, undefined, options);
	return { queryData, narratives };
}

export function refreshStoryDataForDelivery(
	chatId: string,
	slug: string,
	options: StoryRefreshOptions = {},
): Promise<RefreshResult & { code: string }> {
	return refreshStoryDataWithContext(chatId, slug, undefined, options);
}

async function refreshStoryDataWithContext(
	chatId: string,
	slug: string,
	existingExecutionContext?: StoryExecutionContext,
	options: StoryRefreshOptions = {},
): Promise<RefreshResult & { code: string }> {
	const version = options.storyVersionId
		? await storyQueries.getVersionById(chatId, slug, options.storyVersionId)
		: await storyQueries.getLatestVersionByChatAndSlug(chatId, slug);
	if (!version) {
		throw new Error('Story not found');
	}

	const sqlQueries = await getVersionSqlQueries(chatId, version);
	const shouldGenerateViewerCode = options.viewerUserId !== undefined && options.generateViewerCode === true;
	const shouldGenerateClassicCode =
		version.format === 'classic' &&
		((options.viewerUserId === undefined && version.isLiveTextDynamic) || shouldGenerateViewerCode);
	if (Object.keys(sqlQueries).length === 0) {
		if (shouldGenerateViewerCode && version.format === 'classic') {
			throw new Error('Cannot generate viewer story text without query data');
		}
		return { queryData: {}, code: version.code, narratives: {} };
	}

	const chat = await chatQueries.getChatInfo(chatId);
	if (!chat) {
		throw new Error('Chat project not found');
	}

	const executionContext =
		existingExecutionContext ??
		(options.viewerUserId ? await createStoryExecutionContext(chatId, options.viewerUserId) : undefined);
	const queryData = await executeStoryQueries(chatId, sqlQueries, {
		renderSql: stripSqlFilterBlocks,
		semanticBindings: semanticBindingsFromCode(version.code),
		executionContext,
		projectId: chat.projectId,
		billingAccessVerifiedProjectId: options.billingAccessVerifiedProjectId,
	});

	let refreshedCode = version.code;
	const target = { projectId: chat.projectId, userId: options.viewerUserId ?? chat.userId, chatId };
	if (shouldGenerateClassicCode) {
		const generationSource = shouldGenerateViewerCode ? buildViewerSafeStorySource(version.code) : version.code;
		const newCode = await generateDynamicStoryCode(
			target,
			shouldGenerateViewerCode ? 'Story' : version.title,
			generationSource,
			queryData,
			shouldGenerateViewerCode,
		);
		if (!newCode && shouldGenerateViewerCode) {
			throw new Error('Failed to generate viewer story text');
		}
		if (newCode && !options.viewerUserId) {
			await storyQueries.updateLatestVersionCode(chatId, slug, newCode);
		}
		if (newCode) {
			refreshedCode = newCode;
		}
	}

	if (options.viewerUserId) {
		refreshedCode = stripHardcodedFilterOptions(refreshedCode);
	}

	const narratives =
		version.isLiveTextDynamic && version.format === 'custom'
			? await regenerateCustomStoryNarratives(target, version, queryData, options.viewerUserId !== undefined)
			: {};
	const querySources = buildQuerySources(sqlQueries);
	if (options.viewerUserId) {
		if (!executionContext) {
			throw new Error('Viewer story refresh has no execution context');
		}
		const currentPermissionRevision = (await createStoryExecutionContext(chatId, options.viewerUserId))
			.permissionRevision;
		if (currentPermissionRevision !== executionContext.permissionRevision) {
			throw new Error('Viewer permissions changed during story refresh');
		}
		const saved = await storyQueries.upsertStoryViewerDataCache(
			version.storyId,
			version.id,
			options.viewerUserId,
			executionContext.toolContext.projectId,
			executionContext.viewerCacheRevision,
			executionContext.permissionRevision,
			queryData,
			querySources,
			narratives,
			refreshedCode,
		);
		if (!saved) {
			throw new Error('Viewer permissions changed during story refresh');
		}
	} else {
		await storyQueries.upsertStoryDataCache(chatId, slug, queryData, querySources, narratives);
	}

	return { queryData, code: refreshedCode, narratives };
}

async function getVersionSqlQueries(
	chatId: string,
	version: { id: string; code: string; format: StoryFormat },
): Promise<StorySqlQueries> {
	if (version.format === 'classic') {
		return storyQueries.getSqlQueriesFromCode(chatId, version.code);
	}
	const queryIds = extractCustomStoryQueryIds(await storyFileQueries.listVersionFiles(version.id));
	return queryIds.size > 0 ? executeSqlQueries.getLatestSqlQueriesByIds(chatId, queryIds) : {};
}

export interface StoryQueryDataResult {
	queryData: Record<string, { data: unknown[]; columns: string[] }> | null;
	cachedAt: Date | null;
	code: string;
	allowsPersistedFallback?: boolean;
	needsRefresh?: boolean;
}

interface StoryQueryDataOptions {
	storyVersionId?: string;
	viewerUserId?: string;
	/** Return the stored data right away and leave the refresh to the caller, instead of refreshing inline. */
	deferRefresh?: boolean;
	/** Same, but only for a story that was never cached, so going live does not block on its first refresh. */
	deferFirstRefresh?: boolean;
}

export async function getStoryQueryData(
	chatId: string,
	slug: string,
	code: string,
	isLive: boolean,
	cacheSchedule: string | null,
	options: StoryQueryDataOptions = {},
): Promise<StoryQueryDataResult> {
	const viewerUserId =
		options.viewerUserId && (await hasRowSecurity(chatId, options.viewerUserId)) ? options.viewerUserId : undefined;
	if (viewerUserId) {
		const storyVersionId =
			options.storyVersionId ?? (await storyQueries.getLatestVersionByChatAndSlug(chatId, slug))?.id;
		if (!storyVersionId) {
			throw new Error('Story not found');
		}
		return getViewerStoryQueryData(chatId, slug, storyVersionId, code, cacheSchedule, viewerUserId);
	}
	if (!isLive) {
		return {
			queryData: await getQueryDataFromCode(chatId, code),
			cachedAt: null,
			code,
			allowsPersistedFallback: true,
		};
	}
	const cache = await storyQueries.getStoryDataCacheByChatAndSlug(chatId, slug);

	if (cache && !isCacheExpired(cache.cachedAt, cacheSchedule)) {
		return resolveLegacyCache(chatId, code, cache);
	}

	if (shouldDeferRefresh(options, cache, code)) {
		return { ...(await resolveStoredQueryData(chatId, code, cache)), needsRefresh: true };
	}

	try {
		const { queryData, code: refreshedCode } = await refreshStoryDataWithContext(chatId, slug);
		return {
			queryData: Object.keys(queryData).length > 0 ? queryData : null,
			cachedAt: new Date(),
			code: refreshedCode,
		};
	} catch {
		return resolveStoredQueryData(chatId, code, cache);
	}
}

/** Never falls back to the chat's stored results: they were produced with the owner's row-level security. */
async function getViewerStoryQueryData(
	chatId: string,
	slug: string,
	storyVersionId: string,
	code: string,
	cacheSchedule: string | null,
	viewerUserId: string,
): Promise<StoryQueryDataResult> {
	const executionContext = await createStoryExecutionContext(chatId, viewerUserId);
	const cache = await storyQueries.getStoryViewerDataCache(
		chatId,
		slug,
		storyVersionId,
		viewerUserId,
		executionContext.permissionRevision,
	);
	if (
		cache !== null &&
		cache.code !== null &&
		!isCacheExpired(cache.cachedAt, cacheSchedule) &&
		findMissingQueryIds(code, cache.queryData).length === 0
	) {
		return { queryData: cache.queryData, cachedAt: cache.cachedAt, code: stripHardcodedFilterOptions(cache.code) };
	}

	try {
		const { queryData, code: refreshedCode } = await refreshStoryDataWithContext(chatId, slug, executionContext, {
			storyVersionId,
			viewerUserId,
			generateViewerCode: true,
		});
		return {
			queryData: Object.keys(queryData).length > 0 ? queryData : null,
			cachedAt: new Date(),
			code: refreshedCode,
		};
	} catch (error) {
		const currentExecutionContext = await createStoryExecutionContext(chatId, viewerUserId);
		const currentCache =
			currentExecutionContext.permissionRevision === executionContext.permissionRevision
				? cache
				: await storyQueries.getStoryViewerDataCache(
						chatId,
						slug,
						storyVersionId,
						viewerUserId,
						currentExecutionContext.permissionRevision,
					);
		if (currentCache?.code !== null && currentCache?.code !== undefined) {
			return {
				queryData: currentCache.queryData,
				cachedAt: currentCache.cachedAt,
				code: stripHardcodedFilterOptions(currentCache.code),
			};
		}
		throw error;
	}
}

export async function hasRowSecurity(chatId: string, userId?: string): Promise<boolean> {
	const projectId = await requireChatProjectId(chatId);
	if (userId) {
		return hasEffectiveRowSecurityRestrictions(projectId, userId);
	}
	const { tables } = await userGroupQueries.getProjectRowSecurity(projectId);
	return tables.length > 0;
}

function shouldDeferRefresh(options: StoryQueryDataOptions, cache: DBStoryDataCache | null, code: string): boolean {
	const isDeferred = options.deferRefresh || (options.deferFirstRefresh && cache === null);
	return Boolean(isDeferred) && extractQueryIds(code).size > 0;
}

async function resolveStoredQueryData(
	chatId: string,
	code: string,
	cache: DBStoryDataCache | null,
): Promise<StoryQueryDataResult> {
	if (cache) {
		return resolveLegacyCache(chatId, code, cache);
	}
	return {
		queryData: await getQueryDataFromCode(chatId, code),
		cachedAt: null,
		code,
	};
}

async function resolveLegacyCache(
	chatId: string,
	code: string,
	cache: DBStoryDataCache,
): Promise<StoryQueryDataResult> {
	const missing = findMissingQueryIds(code, cache.queryData);
	const queryData =
		missing.length > 0 ? await backfillMissingQueryData(code, cache.queryData, { chatId }) : cache.queryData;
	return { queryData, cachedAt: cache.cachedAt, code };
}

function buildQuerySources(sqlQueries: StorySqlQueries): StoryQuerySources {
	return Object.fromEntries(
		Object.entries(sqlQueries).map(([queryId, query]) => {
			const databaseId = query.databaseId ?? null;
			const normalizedSql = normalizeEffectiveSql(query.sqlQuery);
			const canonicalSource = JSON.stringify({
				sql: normalizedSql,
				databaseId,
				adminMode: query.adminMode,
			});
			return [
				queryId,
				{
					fingerprint: createHash('sha256').update(canonicalSource).digest('hex'),
					databaseId,
					adminMode: query.adminMode,
				},
			];
		}),
	);
}

function normalizeEffectiveSql(sql: string): string {
	return stripSqlFilterBlocks(sql).replaceAll('\r\n', '\n').trim();
}

export interface StoryExecutionContext {
	toolContext: ToolContext;
	enforceExcludedColumns: boolean;
	viewerCacheRevision: number;
	permissionRevision: string;
}

type ExecutedQueryResult = QueryResult & Pick<StoryQueryResult, 'skippedFilterIds'>;

interface StoryQueryExecutionOptions {
	renderSql: (sqlQuery: string) => string;
	/** Story parameters and dimension filters applied to semantic-layer queries. */
	semanticBindings?: SemanticStoryBindings;
	executionContext?: StoryExecutionContext;
	projectId?: string;
	billingAccessVerifiedProjectId?: string;
}

/**
 * Runs the story's queries where each one belongs: the app database, nao's local DuckDB or the
 * warehouse. A local query reads earlier results as tables, so the queries it references are
 * refreshed first and their fresh rows handed to DuckDB in place of the ones stored in the chat.
 */
export async function executeStoryQueries(
	chatId: string,
	sqlQueries: StorySqlQueries,
	options: StoryQueryExecutionOptions,
): Promise<StoryQueryData> {
	const projectId =
		options.executionContext?.toolContext.projectId ?? options.projectId ?? (await requireChatProjectId(chatId));
	if (options.billingAccessVerifiedProjectId !== projectId) {
		await assertProjectCloudBillingAccess(projectId);
	}
	const queries = { ...(await loadUpstreamQueries(chatId, sqlQueries)), ...sqlQueries };
	const executionContext = Object.values(queries).some((query) => !query.adminMode)
		? (options.executionContext ?? (await createStoryExecutionContext(chatId)))
		: null;
	const running = new Map<string, Promise<ExecutedQueryResult>>();
	const loadCatalog = executionContext ? memoizeCatalog(executionContext) : async () => null;

	const run = (queryId: string, ancestors: Set<string>): Promise<ExecutedQueryResult> => {
		const pending = running.get(queryId) ?? execute(queryId, ancestors);
		running.set(queryId, pending);
		return pending;
	};

	const execute = async (queryId: string, ancestors: Set<string>): Promise<ExecutedQueryResult> => {
		const query = queries[queryId]!;
		const sql = options.renderSql(query.sqlQuery);
		if (query.adminMode) {
			return executeAppDatabaseSql(projectId, sql);
		}
		if (!executionContext) {
			throw new Error('Live Story warehouse query has no execution context.');
		}
		if (query.semanticQuery) {
			const bound = await bindSemanticQuery(query.semanticQuery, options.semanticBindings, loadCatalog);
			const result = await compileAndExecuteSemanticQuery(bound.query, executionContext);
			return bound.skippedFilterIds.length > 0 ? { ...result, skippedFilterIds: bound.skippedFilterIds } : result;
		}
		if (query.databaseId !== LOCAL_DATABASE_ID) {
			return executeBillingValidatedRawSql(sql, { executionContext, databaseId: query.databaseId });
		}

		const lineage = new Set([...ancestors, queryId]);
		const upstreamIds = referencedQueryIds(sql).filter((id) => id in queries && !lineage.has(id));
		await Promise.all(
			upstreamIds.map(async (id) => {
				executionContext.toolContext.queryResults.set(id, await run(id, lineage));
			}),
		);
		return executeLocalSql(sql, executionContext.toolContext);
	};

	const entries = await Promise.all(
		Object.keys(sqlQueries).map(async (queryId) => [queryId, await run(queryId, new Set())] as const),
	);
	return Object.fromEntries(entries);
}

/** Queries a local query reads from but which the story itself does not display. */
async function loadUpstreamQueries(chatId: string, sqlQueries: StorySqlQueries): Promise<StorySqlQueries> {
	const upstream: StorySqlQueries = {};
	const requested = new Set(Object.keys(sqlQueries));
	let frontier = sqlQueries;

	while (true) {
		const missing = new Set(
			Object.values(frontier)
				.filter((query) => query.databaseId === LOCAL_DATABASE_ID)
				.flatMap((query) => referencedQueryIds(query.sqlQuery))
				.filter((id) => !requested.has(id)),
		);
		if (missing.size === 0) {
			return upstream;
		}
		missing.forEach((id) => requested.add(id));
		frontier = await storyQueries.getSqlQueriesByIds(chatId, missing);
		Object.assign(upstream, frontier);
	}
}

interface RawSqlExecutionOptions {
	executionContext: StoryExecutionContext;
	databaseId?: string;
	billingAccessVerifiedProjectId?: string;
}

export async function executeRawSql(sqlQuery: string, options: RawSqlExecutionOptions): Promise<QueryResult> {
	const projectId = options.executionContext.toolContext.projectId;
	if (options.billingAccessVerifiedProjectId !== projectId) {
		await assertProjectCloudBillingAccess(projectId);
	}
	return executeBillingValidatedRawSql(sqlQuery, options);
}

async function executeBillingValidatedRawSql(sqlQuery: string, options: RawSqlExecutionOptions): Promise<QueryResult> {
	const context = options.executionContext.toolContext;
	if (options.databaseId === LOCAL_DATABASE_ID) {
		return executeLocalSql(sqlQuery, context);
	}

	const data = await executeWarehouseSql(
		sqlQuery,
		buildWarehouseSqlOptions(options.executionContext, options.databaseId),
	);
	return { data: data.data, columns: data.columns };
}

/** The type of the database a raw query on `databaseId` runs against, as resolved by the warehouse executor. */
export async function resolveRawSqlDatabaseType(
	executionContext: StoryExecutionContext,
	databaseId: string | undefined,
): Promise<string> {
	if (databaseId === LOCAL_DATABASE_ID) {
		return 'duckdb';
	}
	const { dialect } = await validateWarehouseSql('SELECT 1', buildWarehouseSqlOptions(executionContext, databaseId));
	return dialect.toLowerCase();
}

function buildWarehouseSqlOptions(executionContext: StoryExecutionContext, databaseId: string | undefined) {
	const context = executionContext.toolContext;
	return {
		projectFolder: context.projectFolder,
		databaseId,
		envVars: context.envVars,
		azureAccessToken: context.azureAccessToken,
		enforceExcludedColumns: executionContext.enforceExcludedColumns,
		tableAccess: context.warehouseTableAccess,
		rowSecurity: context.warehouseRowSecurity ?? { enforced: false },
	};
}

function memoizeCatalog(executionContext: StoryExecutionContext): CatalogLoader {
	let catalog: ReturnType<CatalogLoader> | null = null;
	return () => {
		catalog ??= describeSemanticLayerCached(executionContext.toolContext).catch(() => null);
		return catalog;
	};
}

/** Compiled again on every run, so the story follows the semantic layer's current metric definitions. */
async function compileAndExecuteSemanticQuery(
	semanticQuery: SemanticQuery,
	executionContext: StoryExecutionContext,
): Promise<QueryResult> {
	const compiled = await compileSemanticQuery(semanticQuery, executionContext.toolContext);
	return executeBillingValidatedRawSql(compiled.sql, { executionContext, databaseId: compiled.database_id });
}

async function executeLocalSql(sqlQuery: string, context: ToolContext): Promise<QueryResult> {
	const { result } = await runQueryOnLocalFiles(sqlQuery, context);
	return { data: result.data, columns: result.columns };
}

export async function createStoryExecutionContext(chatId: string, userId?: string): Promise<StoryExecutionContext> {
	const [projectId, ownerId] = await Promise.all([requireChatProjectId(chatId), chatQueries.getChatOwnerId(chatId)]);
	const executionUserId = userId ?? ownerId;
	if (!executionUserId) {
		throw new Error('Chat owner not found');
	}
	const viewerCacheRevision = await storyQueries.getProjectViewerCacheRevision(projectId);
	const toolContext = await buildToolContext({ projectId, userId: executionUserId, chatId });
	if ((await storyQueries.getProjectViewerCacheRevision(projectId)) !== viewerCacheRevision) {
		throw new Error('Viewer permissions changed while building the execution context');
	}
	const enforceExcludedColumns = await resolveExcludedColumnEnforcement(projectId, toolContext.agentSettings);
	return {
		toolContext,
		enforceExcludedColumns,
		viewerCacheRevision,
		permissionRevision: createHash('sha256')
			.update(
				JSON.stringify([
					toolContext.warehouseTableAccess,
					toolContext.warehouseRowSecurity,
					enforceExcludedColumns,
					viewerCacheRevision,
				]),
			)
			.digest('hex'),
	};
}

async function requireChatProjectId(chatId: string): Promise<string> {
	const projectId = await chatQueries.getChatProjectId(chatId);
	if (!projectId) {
		throw new Error('Chat project not found');
	}
	return projectId;
}

async function executeAppDatabaseSql(projectId: string, sqlQuery: string): Promise<QueryResult> {
	const { columns, rows } = await queryAppDb(projectId, sqlQuery);
	return { data: rows, columns };
}

export function isCacheExpired(cachedAt: Date, cacheSchedule: string | null): boolean {
	if (!cacheSchedule) {
		return false;
	}

	try {
		const interval = CronExpressionParser.parse(cacheSchedule, { currentDate: new Date() });
		const prevScheduledTime = interval.prev().toDate();
		return cachedAt.getTime() < prevScheduledTime.getTime();
	} catch {
		return false;
	}
}

async function generateDynamicStoryCode(
	target: StoryRefreshTarget,
	title: string,
	originalCode: string,
	queryData: Record<string, { data: unknown[]; columns: string[] }>,
	allowDisplayCopyChanges = false,
): Promise<string | null> {
	const liveStoryModel = await resolveLiveStoryModel(target);
	if (!liveStoryModel) {
		return null;
	}

	try {
		const querySummaries = buildQueryDataSummary(queryData);
		const systemPrompt = renderToMarkdown(
			LiveStoryRefreshPrompt({ title, originalCode, querySummaries, allowDisplayCopyChanges }),
		);

		const output = await generateLiveStoryOutput(
			target,
			liveStoryModel,
			systemPrompt,
			'Refresh the story narrative with the latest query results.',
			z.object({ code: z.string().min(1) }),
		);

		const candidate = stripCodeFence(output.code.trim());
		if (!candidate || !preservesStoryStructure(originalCode, candidate, allowDisplayCopyChanges)) {
			return null;
		}

		return candidate;
	} catch (error) {
		throw error instanceof Error ? error : new Error(String(error));
	}
}

/** Narratives are rewritten from the text in the published source, never from a previous refresh, so they cannot drift. */
async function regenerateCustomStoryNarratives(
	target: StoryRefreshTarget,
	version: { id: string; title: string },
	queryData: Record<string, { data: unknown[]; columns: string[] }>,
	viewerSafe = false,
): Promise<StoryNarratives> {
	const sources = extractStoryNarratives(await storyFileQueries.listVersionFiles(version.id));
	if (sources.length === 0) {
		return {};
	}
	const liveStoryModel = await resolveLiveStoryModel(target);
	if (!liveStoryModel) {
		return {};
	}

	const systemPrompt = renderToMarkdown(
		LiveCustomStoryNarrativesPrompt({
			title: viewerSafe ? 'Story' : version.title,
			narratives: viewerSafe ? sources.map(({ id }) => ({ id, text: 'Viewer-specific narrative.' })) : sources,
			querySummaries: buildQueryDataSummary(queryData),
		}),
	);
	const output = await generateLiveStoryOutput(
		target,
		liveStoryModel,
		systemPrompt,
		'Rewrite every narrative with the latest query results.',
		z.object({ narratives: z.array(z.object({ id: z.string(), text: z.string() })) }),
	);
	return keepKnownNarratives(sources, output.narratives);
}

function keepKnownNarratives(sources: StoryNarrativeSource[], rewritten: StoryNarrativeSource[]): StoryNarratives {
	const knownIds = new Set(sources.map((source) => source.id));
	const narratives: StoryNarratives = {};
	for (const { id, text } of rewritten) {
		const trimmed = text.trim();
		if (knownIds.has(id) && trimmed) {
			narratives[id] = trimmed;
		}
	}
	return narratives;
}

type LiveStoryModel = NonNullable<Awaited<ReturnType<typeof resolveLiveStoryModel>>>;

async function resolveLiveStoryModel(target: StoryRefreshTarget) {
	const pinned = await resolveDefaultModelSelection(target.projectId, 'live_story');
	const provider = pinned?.provider ?? (await llmConfigQueries.getProjectModelProvider(target.projectId));
	if (!provider) {
		return null;
	}

	const modelId = pinned?.modelId ?? getDefaultModelId(provider);
	const model = await resolveProviderModel(target.projectId, provider, modelId, true, {
		userId: target.userId,
		projectId: target.projectId,
		chatId: target.chatId,
		category: 'story',
	});
	return model ? { provider, model } : null;
}

async function generateLiveStoryOutput<T>(
	target: StoryRefreshTarget,
	{ provider, model }: LiveStoryModel,
	systemPrompt: string,
	instruction: string,
	schema: z.ZodType<T>,
): Promise<T> {
	const { output, usage } = await generateText({
		...model,
		system: systemPrompt,
		messages: [{ role: 'user', content: instruction }],
		output: Output.object({ schema }),
		maxOutputTokens: MAX_OUTPUT_TOKENS,
		experimental_telemetry: llmTelemetry('nao-live-story', { projectId: target.projectId, tags: [provider] }),
	});

	scheduleSaveLlmInferenceRecord({
		type: 'live_story_refresh',
		projectId: target.projectId,
		userId: target.userId,
		chatId: target.chatId,
		llmProvider: provider,
		llmModelId: model.model.modelId,
		...convertToTokenUsage(usage),
	});

	return output;
}

function buildQueryDataSummary(queryData: Record<string, { data: unknown[]; columns: string[] }>) {
	return Object.entries(queryData).map(([queryId, result]) => {
		const rows = result.data.filter((row): row is Record<string, unknown> => isRecord(row));
		const rowsForModel = rows.length <= MAX_RENDERED_ROWS ? rows : rows.slice(0, MAX_RENDERED_ROWS);

		return {
			queryId,
			columns: result.columns,
			rowCount: rows.length,
			rows: rowsForModel,
			truncated: rowsForModel.length !== rows.length,
			numericSummaries: buildNumericSummaries(rows, result.columns),
		};
	});
}

function buildNumericSummaries(rows: Record<string, unknown>[], columns: string[]) {
	const summaries: Record<string, { min: number; max: number; avg: number; sum: number; count: number }> = {};

	for (const column of columns) {
		const values = rows
			.map((row) => toFiniteNumber(row[column]))
			.filter((value): value is number => value !== null);

		if (!values.length) {
			continue;
		}

		let min = Infinity;
		let max = -Infinity;
		let sum = 0;
		for (const v of values) {
			if (v < min) {
				min = v;
			}
			if (v > max) {
				max = v;
			}
			sum += v;
		}
		summaries[column] = {
			min,
			max,
			avg: sum / values.length,
			sum,
			count: values.length,
		};
	}

	return summaries;
}

function toFiniteNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === 'string') {
		const normalized = value.replaceAll(',', '').trim();
		if (!normalized) {
			return null;
		}

		const parsed = Number(normalized);
		return Number.isFinite(parsed) ? parsed : null;
	}

	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripCodeFence(value: string): string {
	return value
		.replace(/^```(?:markdown)?\s*/i, '')
		.replace(/\s*```$/, '')
		.trim();
}

function preservesStoryStructure(
	originalCode: string,
	candidateCode: string,
	allowDisplayCopyChanges = false,
): boolean {
	const normalizeStructureToken = allowDisplayCopyChanges ? stripViewerSensitiveTagCopy : (token: string) => token;
	const originalStructure = extractStructureTokens(originalCode).map(normalizeStructureToken);
	const candidateStructure = extractStructureTokens(candidateCode).map(normalizeStructureToken);
	const originalHeadings = allowDisplayCopyChanges
		? extractHeadingLevels(originalCode)
		: extractHeadingTokens(originalCode);
	const candidateHeadings = allowDisplayCopyChanges
		? extractHeadingLevels(candidateCode)
		: extractHeadingTokens(candidateCode);
	return (
		JSON.stringify(originalStructure) === JSON.stringify(candidateStructure) &&
		JSON.stringify(originalHeadings) === JSON.stringify(candidateHeadings)
	);
}

function extractStructureTokens(code: string): string[] {
	return code.match(storyStructureTokenRegex()) ?? [];
}

function extractHeadingTokens(code: string): string[] {
	return code
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => /^#{1,6}\s+\S/.test(line));
}

function extractHeadingLevels(code: string): number[] {
	return extractHeadingTokens(code).map((heading) => heading.match(/^#+/)![0].length);
}

function buildViewerSafeStorySource(code: string): string {
	const tags: string[] = [];
	const tokenized = code.replace(storyStructureTokenRegex(), (tag) => {
		const index = tags.push(redactViewerStoryTag(tag)) - 1;
		return `@@NAO_STORY_TAG_${index}@@`;
	});
	const redacted = tokenized
		.split('\n')
		.map((line) => {
			const placeholders = line.match(/@@NAO_STORY_TAG_\d+@@/g) ?? [];
			const heading = line.match(/^\s*(#{1,6})\s+/);
			if (heading) {
				return [`${heading[1]} Viewer-specific section`, ...placeholders].join(' ');
			}
			if (placeholders.length > 0) {
				return placeholders.join(' ');
			}
			return line.trim() ? 'Viewer-specific narrative.' : '';
		})
		.join('\n');
	return redacted.replace(/@@NAO_STORY_TAG_(\d+)@@/g, (_placeholder, index: string) => tags[Number(index)] ?? '');
}

function storyStructureTokenRegex(): RegExp {
	return new RegExp(
		String.raw`<grid(?:\s+${TAG_ATTRS})?>|<\/grid>|<chart\s+${TAG_ATTRS}\/?>|<table\s+${TAG_ATTRS}\/?>|<filter\s+${TAG_ATTRS}\/?>|<map\s+${TAG_ATTRS}\/?>|<parameter\s+${TAG_ATTRS}\/?>|<tab\s+${TAG_ATTRS}>|<\/tab>`,
		'g',
	);
}

function redactViewerStoryTag(tag: string): string {
	const redacted = stripViewerSensitiveTagCopy(tag);
	if (redacted.startsWith('<tab ') && !/\stitle\s*=/.test(redacted)) {
		return redacted.replace(/>$/, ' title="Section">');
	}
	return redacted;
}

function stripViewerSensitiveTagCopy(tag: string): string {
	const sensitiveAttributeRegex = new RegExp(
		String.raw`\s+(?:title|label|x_axis_label|y_axis_label|y_axis_right_label)\s*=\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')`,
		'g',
	);
	const withoutDisplayCopy = redactViewerSeriesLabels(tag.replace(sensitiveAttributeRegex, ''));
	return withoutDisplayCopy.startsWith('<filter ')
		? withoutDisplayCopy.replace(
				new RegExp(String.raw`\s+options\s*=\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')`, 'g'),
				'',
			)
		: withoutDisplayCopy;
}

function redactViewerSeriesLabels(tag: string): string {
	let foundSeries = false;
	const redacted = tag.replace(/(\s+series\s*=\s*)'([^']*)'/g, (attribute, prefix: string, value: string) => {
		foundSeries = true;
		try {
			const series = JSON.parse(value);
			if (!Array.isArray(series)) {
				return attribute.replace(/("label"\s*:\s*)"(?:[^"\\]|\\.)*"/g, '$1"Series"');
			}
			const safeSeries = series.map((item) => {
				if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.label !== 'string') {
					return item;
				}
				const dataKey = typeof item.data_key === 'string' && /^\w+$/.test(item.data_key) ? item.data_key : '';
				return { ...item, label: dataKey ? formatColumnLabel(dataKey) : 'Series' };
			});
			return `${prefix}'${JSON.stringify(safeSeries)}'`;
		} catch {
			return attribute.replace(/("label"\s*:\s*)"(?:[^"\\]|\\.)*"/g, '$1"Series"');
		}
	});
	return foundSeries ? redacted : redacted.replace(/("label"\s*:\s*)"(?:[^"\\]|\\.)*"/g, '$1"Series"');
}

function stripHardcodedFilterOptions(code: string): string {
	const filterTagRegex = new RegExp(String.raw`<filter\s+${TAG_ATTRS}\/?>`, 'g');
	const optionsAttributeRegex = /\s+options\s*=\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
	return code.replace(filterTagRegex, (tag) => tag.replace(optionsAttributeRegex, ''));
}
