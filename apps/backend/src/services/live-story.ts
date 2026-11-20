import { createHash } from 'node:crypto';

import { stripSqlFilterBlocks } from '@nao/shared/sql-template';
import type { StoryNarratives } from '@nao/shared/story-app';
import { extractQueryIds, TAG_ATTRS } from '@nao/shared/story-segments';
import { LOCAL_DATABASE_ID } from '@nao/shared/tools';
import type { StoryFormat } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
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
import * as projectQueries from '../queries/project.queries';
import { getQueryDataFromCode } from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyFileQueries from '../queries/story-file.queries';
import type { StoryQuerySources } from '../types/story-cache';
import type { ChatlessToolContext, QueryResult, ToolContext } from '../types/tools';
import { convertToTokenUsage } from '../utils/ai';
import { resolveDefaultChatModel, resolveDefaultModelSelection, resolveProviderModel } from '../utils/llm';
import { describeError, logger } from '../utils/logger';
import { scheduleSaveLlmInferenceRecord } from '../utils/schedule-task';
import { referencedQueryIds } from '../utils/sql-file-paths';
import type { StoryNarrativeSource } from '../utils/story-kit-narratives';
import { extractStoryNarratives } from '../utils/story-kit-narratives';
import {
	backfillMissingQueryData,
	extractCustomStoryQueryIds,
	findMissingQueryIds,
	getStandaloneStoryQueryData,
	pickQueryData,
} from '../utils/story-query-data';
import { buildChatlessToolContext, buildToolContext, MAX_OUTPUT_TOKENS } from './agent';
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
import {
	loadStorySqlQueries,
	loadUpstreamSqlQueries,
	type SqlQueryLoader,
	type StoryQueryOrigin,
} from './story-sql-queries';
import { executeWarehouseSql, validateWarehouseSql } from './warehouse-sql.service';

const MAX_RENDERED_ROWS = 60;

interface StoryRefreshTarget {
	projectId: string;
	userId: string;
	chatId: string | null;
}

/** The user whose access a story's queries run with, in the story's project and chat, if any. */
export interface StoryExecutionPrincipal {
	projectId: string;
	ownerId: string;
	chatId: string | null;
}

export interface StoryQueryScope extends StoryExecutionPrincipal {
	/** Finds the queries a local query reads from. */
	loadSqlQueries: SqlQueryLoader;
	/** The rows last saved for these queries, shown when one cannot run. */
	loadStoredQueryData: (queryIds: Set<string>) => Promise<StoryQueryData>;
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
): Promise<StoryQueryResult> {
	const query = await storyQueries.getSqlQueryById(chatId, queryId);
	if (!query) {
		throw new Error(`Query ${queryId} not found in chat ${chatId}`);
	}
	return executeSingleStoryQuery(await resolveChatQueryScope(chatId), queryId, query, options);
}

/** Runs one query of a story from its chat, or else from the SQL saved with it; a query without SQL shows its saved rows. */
export async function executeStoryLiveQuery(
	story: StoryQueryOrigin,
	queryId: string,
	options: LiveQueryOptions = {},
): Promise<StoryQueryResult> {
	const [{ [queryId]: query }, scope] = await Promise.all([
		loadStorySqlQueries(story, [queryId]),
		resolveStoryQueryScope(story),
	]);
	if (!query) {
		return resultOrStoredRows(scope, {}, queryId);
	}
	return executeSingleStoryQuery(scope, queryId, query, options);
}

/** A query the scope could not run, e.g. one reading the app database without admin access, shows its saved rows. */
async function resultOrStoredRows(
	scope: StoryQueryScope,
	queryData: StoryQueryData,
	queryId: string,
): Promise<StoryQueryResult> {
	const result = queryData[queryId] ?? (await scope.loadStoredQueryData(new Set([queryId])))[queryId];
	if (!result) {
		throw new Error(`Query ${queryId} could not run and has no saved rows.`);
	}
	return result;
}

export interface RefreshResult {
	/** Fresh rows, plus the saved rows of queries this refresh could not run. */
	queryData: StoryQueryData;
	narratives: StoryNarratives;
	queriesRefreshed: number;
}

interface StoryRefreshOptions {
	billingAccessVerifiedProjectId?: string;
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
	const { queryData, narratives, queriesRefreshed } = await refreshStory(
		await requireStoryByChatAndSlug(chatId, slug),
		options,
	);
	return { queryData, narratives, queriesRefreshed };
}

/** Refreshes a story, in a chat or standalone, with the access of its owner. */
export async function refreshStoryById(storyId: string, options: StoryRefreshOptions = {}): Promise<RefreshResult> {
	const { queryData, narratives, queriesRefreshed } = await refreshStory(await requireStoryById(storyId), options);
	return { queryData, narratives, queriesRefreshed };
}

async function refreshStory(
	story: StoryQueryOrigin,
	options: StoryRefreshOptions = {},
): Promise<RefreshResult & { code: string }> {
	const version = await storyQueries.getLatestVersionByStoryId(story.id);
	if (!version) {
		throw new Error('Story not found');
	}

	const queryIds = await getVersionQueryIds(version);
	const sqlQueries = await loadStorySqlQueries(story, queryIds);
	if (Object.keys(sqlQueries).length === 0) {
		return unrefreshedResult(story, queryIds, version.code);
	}

	const scope = await resolveStoryQueryScope(story);
	const freshData = await executeStoryQueries(scope, sqlQueries, {
		renderSql: stripSqlFilterBlocks,
		semanticBindings: semanticBindingsFromCode(version.code),
		billingAccessVerifiedProjectId: options.billingAccessVerifiedProjectId,
	});
	if (Object.keys(freshData).length === 0) {
		return unrefreshedResult(story, queryIds, version.code);
	}
	const cachedData = await withKeptQueryData(story, queryIds, freshData);
	const queryData = pickQueryData(cachedData, queryIds);

	const target = { projectId: scope.projectId, userId: scope.ownerId, chatId: story.chatId };
	const code = await refreshDynamicCode(story.id, target, version, queryData);
	const generatedNarratives =
		version.isLiveTextDynamic && version.format === 'custom'
			? await keepCurrentTextOnFailure(
					target,
					() => regenerateCustomStoryNarratives(target, version, queryData),
					() => getCachedNarratives(story.id),
				)
			: undefined;
	const refreshedQueries = Object.fromEntries(Object.entries(sqlQueries).filter(([id]) => id in freshData));
	await storyQueries.upsertStoryDataCacheByStoryId(
		story.id,
		cachedData,
		generatedNarratives,
		buildQuerySources(refreshedQueries),
	);

	return {
		queryData,
		code,
		narratives: generatedNarratives ?? {},
		queriesRefreshed: Object.keys(freshData).length,
	};
}

/** A standalone story reads queries that none of its saved SQL can rerun, so going live would change nothing. */
export async function hasOnlyFrozenQueries(story: StoryQueryOrigin): Promise<boolean> {
	const queryIds = await getLatestQueryIds(story.id);
	return queryIds.size > 0 && Object.keys(await loadStorySqlQueries(story, queryIds)).length === 0;
}

/** The queries the latest version of a story reads but has no SQL for. */
export async function listQueryIdsWithoutSql(story: StoryQueryOrigin): Promise<Set<string>> {
	const queryIds = await getLatestQueryIds(story.id);
	const queries = await loadStorySqlQueries(story, queryIds);
	return new Set([...queryIds].filter((id) => !(id in queries)));
}

async function getLatestQueryIds(storyId: string): Promise<Set<string>> {
	const version = await storyQueries.getLatestVersionByStoryId(storyId);
	return version ? getVersionQueryIds(version) : new Set<string>();
}

async function getVersionQueryIds(version: { id: string; code: string; format: StoryFormat }): Promise<Set<string>> {
	if (version.format === 'classic') {
		return extractQueryIds(version.code);
	}
	return extractCustomStoryQueryIds(await storyFileQueries.listVersionFiles(version.id));
}

/**
 * Cached rows a refresh did not replace are kept: those of queries it could not run (no SQL, or the app database
 * without admin access), and for a standalone story those only older versions use, since its history reads them
 * from this cache while a chat story's reads them from its chat.
 */
async function withKeptQueryData(
	story: StoryQueryOrigin,
	queryIds: Set<string>,
	freshData: StoryQueryData,
): Promise<StoryQueryData> {
	const cached = (await storyQueries.getStoryDataCacheByStoryId(story.id))?.queryData ?? {};
	return { ...(story.chatId ? pickQueryData(cached, queryIds) : cached), ...freshData };
}

/** Nothing could run, so the cache keeps its date and the text is not rewritten from rows that did not change. */
async function unrefreshedResult(
	story: StoryQueryOrigin,
	queryIds: Set<string>,
	code: string,
): Promise<RefreshResult & { code: string }> {
	const queryData = pickQueryData(await withKeptQueryData(story, queryIds, {}), queryIds);
	return { queryData, code, narratives: {}, queriesRefreshed: 0 };
}

async function refreshDynamicCode(
	storyId: string,
	target: StoryRefreshTarget,
	version: { id: string; title: string; code: string; format: StoryFormat; isLiveTextDynamic: boolean },
	queryData: StoryQueryData,
): Promise<string> {
	if (!version.isLiveTextDynamic || version.format !== 'classic') {
		return version.code;
	}
	const newCode = await keepCurrentTextOnFailure(
		target,
		() => generateDynamicStoryCode(target, version.title, version.code, queryData),
		async () => null,
	);
	if (!newCode) {
		return version.code;
	}
	const isSaved = await storyQueries.updateVersionCodeIfLatest(storyId, version.id, newCode);
	return isSaved ? newCode : version.code;
}

export interface StoryQueryDataResult {
	queryData: Record<string, { data: unknown[]; columns: string[] }> | null;
	cachedAt: Date | null;
	code: string;
	allowsPersistedFallback?: boolean;
	needsRefresh?: boolean;
}

interface StoryQueryDataOptions {
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
	if (!isLive) {
		return {
			queryData: await getQueryDataFromCode(chatId, code),
			cachedAt: null,
			code,
			allowsPersistedFallback: true,
		};
	}
	return getLiveStoryQueryData(
		{
			readCache: () => storyQueries.getStoryDataCacheByChatAndSlug(chatId, slug),
			readStored: (cache) => resolveStoredQueryData(chatId, code, cache),
			refresh: async () => {
				const { queryData, code: refreshedCode } = await refreshStory(
					await requireStoryByChatAndSlug(chatId, slug),
				);
				return {
					queryData: Object.keys(queryData).length > 0 ? queryData : null,
					cachedAt: new Date(),
					code: refreshedCode,
				};
			},
		},
		code,
		cacheSchedule,
		options,
	);
}

/** The rows of a story without a chat: the frozen snapshot, or once live, rows refreshed from the SQL saved with it. */
export async function getStandaloneStoryLiveQueryData(
	storyId: string,
	code: string,
	isLive: boolean,
	cacheSchedule: string | null,
	options: StoryQueryDataOptions = {},
): Promise<StoryQueryDataResult> {
	if (!isLive) {
		return getStandaloneStoryQueryData(storyId, code);
	}
	const readStored = async (cache: DBStoryDataCache | null): Promise<StoryQueryDataResult> => {
		return {
			queryData: cache ? pickQueryData(cache.queryData, extractQueryIds(code)) : null,
			cachedAt: cache?.cachedAt ?? null,
			code,
		};
	};
	return getLiveStoryQueryData(
		{
			readCache: () => storyQueries.getStoryDataCacheByStoryId(storyId),
			readStored,
			refresh: async (cache) => {
				const {
					queryData,
					code: refreshedCode,
					queriesRefreshed,
				} = await refreshStory(await requireStoryById(storyId));
				if (queriesRefreshed === 0) {
					return readStored(cache);
				}
				return { queryData, cachedAt: new Date(), code: refreshedCode };
			},
		},
		code,
		cacheSchedule,
		options,
	);
}

interface LiveStoryDataSource {
	readCache: () => Promise<DBStoryDataCache | null>;
	/** The data shown without refreshing, from the cache when there is one. */
	readStored: (cache: DBStoryDataCache | null) => Promise<StoryQueryDataResult>;
	refresh: (cache: DBStoryDataCache | null) => Promise<StoryQueryDataResult>;
}

async function getLiveStoryQueryData(
	source: LiveStoryDataSource,
	code: string,
	cacheSchedule: string | null,
	options: StoryQueryDataOptions,
): Promise<StoryQueryDataResult> {
	const cache = await source.readCache();

	if (cache && !isCacheExpired(cache.cachedAt, cacheSchedule)) {
		return source.readStored(cache);
	}

	if (shouldDeferRefresh(options, cache, code)) {
		return { ...(await source.readStored(cache)), needsRefresh: true };
	}

	try {
		return await source.refresh(cache);
	} catch {
		return source.readStored(cache);
	}
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
	toolContext: ToolContext | ChatlessToolContext;
	enforceExcludedColumns: boolean;
}

type ExecutedQueryResult = QueryResult & Pick<StoryQueryResult, 'skippedFilterIds'>;

interface StoryQueryExecutionOptions {
	renderSql: (sqlQuery: string) => string;
	/** Story parameters and dimension filters applied to semantic-layer queries. */
	semanticBindings?: SemanticStoryBindings;
	executionContext?: StoryExecutionContext;
	billingAccessVerifiedProjectId?: string;
}

/**
 * Runs the story's queries where each one belongs: the app database, nao's local DuckDB or the
 * warehouse. A local query reads earlier results as tables, so the queries it references are
 * refreshed first and their fresh rows handed to DuckDB in place of the ones stored in the chat.
 * App database queries only run when the scope's owner is a project admin; otherwise they are
 * left out of the results.
 */
export async function executeStoryQueries(
	scope: StoryQueryScope,
	sqlQueries: StorySqlQueries,
	options: StoryQueryExecutionOptions,
): Promise<StoryQueryData> {
	const projectId = options.executionContext?.toolContext.projectId ?? scope.projectId;
	if (options.billingAccessVerifiedProjectId !== projectId) {
		await assertProjectCloudBillingAccess(projectId);
	}
	const queries: StorySqlQueries = {
		...(await loadUpstreamSqlQueries(sqlQueries, scope.loadSqlQueries)),
		...sqlQueries,
	};
	const runnableIds = findRunnableQueryIds(queries, {
		canRunAdminQueries: await canRunAdminQueriesAs(scope, queries),
		hasChat: scope.chatId !== null,
		renderSql: options.renderSql,
	});
	const executionContext = Object.values(queries).some((query) => !query.adminMode)
		? (options.executionContext ?? (await createOwnerExecutionContext(scope)))
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
		const upstreamIds = referencedQueryIds(sql).filter(
			(id) => id in queries && !lineage.has(id) && runnableIds.has(id),
		);
		await Promise.all(
			upstreamIds.map(async (id) => {
				executionContext.toolContext.queryResults.set(id, await run(id, lineage));
			}),
		);
		return executeLocalSql(sql, executionContext.toolContext);
	};

	const entries = await Promise.all(
		Object.keys(sqlQueries)
			.filter((queryId) => runnableIds.has(queryId))
			.map(async (queryId) => [queryId, await run(queryId, new Set())] as const),
	);
	return Object.fromEntries(entries);
}

interface RunnableQueryRules {
	canRunAdminQueries: boolean;
	/** A chat keeps the rows of queries run there, so a local query can read one without its SQL. */
	hasChat: boolean;
	renderSql: (sqlQuery: string) => string;
}

/**
 * A query runs unless it reads the app database without admin access, or it is a local query reading a result
 * that cannot be produced: such a query keeps its saved rows instead of failing the whole refresh.
 */
function findRunnableQueryIds(queries: StorySqlQueries, rules: RunnableQueryRules): Set<string> {
	const verdicts = new Map<string, boolean>();

	function canRun(queryId: string, lineage: Set<string>): boolean {
		const query = queries[queryId];
		if (!query) {
			return rules.hasChat;
		}
		if (query.adminMode) {
			return rules.canRunAdminQueries;
		}
		if (query.databaseId !== LOCAL_DATABASE_ID) {
			return true;
		}
		const nextLineage = new Set([...lineage, queryId]);
		return referencedQueryIds(rules.renderSql(query.sqlQuery))
			.filter((id) => !nextLineage.has(id))
			.every((id) => isRunnable(id, nextLineage));
	}

	function isRunnable(queryId: string, lineage: Set<string>): boolean {
		const known = verdicts.get(queryId);
		if (known !== undefined) {
			return known;
		}
		const verdict = canRun(queryId, lineage);
		verdicts.set(queryId, verdict);
		return verdict;
	}

	return new Set(Object.keys(queries).filter((queryId) => isRunnable(queryId, new Set())));
}

/** The owner's current role decides, so a story never reads the app database with access its owner lost. */
async function canRunAdminQueriesAs(principal: StoryExecutionPrincipal, queries: StorySqlQueries): Promise<boolean> {
	if (!Object.values(queries).some((query) => query.adminMode)) {
		return false;
	}
	return (await projectQueries.getUserRoleInProject(principal.projectId, principal.ownerId)) === 'admin';
}

async function executeSingleStoryQuery(
	scope: StoryQueryScope,
	queryId: string,
	query: StorySqlQuery,
	options: LiveQueryOptions,
): Promise<StoryQueryResult> {
	const queryData = await executeStoryQueries(
		scope,
		{ [queryId]: query },
		{
			renderSql: stripSqlFilterBlocks,
			semanticBindings: options.storyCode ? semanticBindingsFromCode(options.storyCode) : undefined,
			billingAccessVerifiedProjectId: options.billingAccessVerifiedProjectId,
		},
	);
	return resultOrStoredRows(scope, queryData, queryId);
}

export async function resolveChatQueryScope(chatId: string): Promise<StoryQueryScope> {
	const [projectId, ownerId] = await Promise.all([requireChatProjectId(chatId), chatQueries.getChatOwnerId(chatId)]);
	if (!ownerId) {
		throw new Error('Chat owner not found');
	}
	return {
		projectId,
		ownerId,
		chatId,
		loadSqlQueries: (queryIds) => storyQueries.getSqlQueriesByIds(chatId, queryIds),
		loadStoredQueryData: (queryIds) => executeSqlQueries.getLatestSqlQueryDataByIds(chatId, queryIds),
	};
}

/** A story's queries run as its owner, never as the viewer, whether the story lives in a chat or stands alone. */
export async function resolveStoryQueryScope(story: StoryQueryOrigin): Promise<StoryQueryScope> {
	const [projectId, ownerId] = await Promise.all([
		storyQueries.getStoryProjectId(story.id),
		storyQueries.getStoryOwnerId(story.id),
	]);
	if (!projectId || !ownerId) {
		throw new Error('Story owner not found');
	}
	return {
		projectId,
		ownerId,
		chatId: story.chatId,
		loadSqlQueries: (queryIds) => loadStorySqlQueries(story, queryIds),
		loadStoredQueryData: (queryIds) => loadStoredStoryQueryData(story, queryIds),
	};
}

/** The rows saved with the story, or else the ones its chat stored when the queries ran there. */
async function loadStoredStoryQueryData(story: StoryQueryOrigin, queryIds: Set<string>): Promise<StoryQueryData> {
	const cache = await storyQueries.getStoryDataCacheByStoryId(story.id);
	const saved = cache ? pickQueryData(cache.queryData, queryIds) : {};
	const missingIds = new Set([...queryIds].filter((id) => !(id in saved)));
	if (!story.chatId || missingIds.size === 0) {
		return saved;
	}
	return { ...(await executeSqlQueries.getLatestSqlQueryDataByIds(story.chatId, missingIds)), ...saved };
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
		warehouseAccessToken: context.warehouseAccessToken,
		enforceExcludedColumns: executionContext.enforceExcludedColumns,
		tableAccess: context.warehouseTableAccess,
		rowSecurity: context.warehouseRowSecurity ?? { enforced: false },
		queryTag: context.sqlQueryTag,
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

async function executeLocalSql(sqlQuery: string, context: ToolContext | ChatlessToolContext): Promise<QueryResult> {
	const { result } = await runQueryOnLocalFiles(sqlQuery, context);
	return { data: result.data, columns: result.columns };
}

/** Queries run with the access of `userId`, the chat owner by default. */
export async function createStoryExecutionContext(chatId: string, userId?: string): Promise<StoryExecutionContext> {
	const [projectId, runAsUserId] = await Promise.all([
		requireChatProjectId(chatId),
		userId ?? chatQueries.getChatOwnerId(chatId),
	]);
	if (!runAsUserId) {
		throw new Error('Chat owner not found');
	}
	return createOwnerExecutionContext({ projectId, ownerId: runAsUserId, chatId });
}

export async function createOwnerExecutionContext(principal: StoryExecutionPrincipal): Promise<StoryExecutionContext> {
	const { projectId, ownerId: userId, chatId } = principal;
	const toolContext = chatId
		? await buildToolContext({ projectId, userId, chatId, querySource: 'story' })
		: await buildChatlessToolContext({ projectId, userId, querySource: 'story' });
	return {
		toolContext,
		enforceExcludedColumns: await resolveExcludedColumnEnforcement(projectId, toolContext.agentSettings),
	};
}

async function requireChatProjectId(chatId: string): Promise<string> {
	const projectId = await chatQueries.getChatProjectId(chatId);
	if (!projectId) {
		throw new Error('Chat project not found');
	}
	return projectId;
}

export async function requireStoryById(storyId: string) {
	const story = await storyQueries.getStoryById(storyId);
	if (!story) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
	}
	return story;
}

export async function requireStoryByChatAndSlug(chatId: string, slug: string) {
	const story = await storyQueries.getStoryByChatAndSlug(chatId, slug);
	if (!story) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
	}
	return story;
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
): Promise<string | null> {
	const liveStoryModel = await resolveLiveStoryModel(target);
	if (!liveStoryModel) {
		return null;
	}

	const querySummaries = buildQueryDataSummary(queryData);
	const systemPrompt = renderToMarkdown(LiveStoryRefreshPrompt({ title, originalCode, querySummaries }));

	const output = await generateLiveStoryOutput(
		target,
		liveStoryModel,
		systemPrompt,
		'Refresh the story narrative with the latest query results.',
		z.object({ code: z.string().min(1) }),
	);

	const candidate = stripCodeFence(output.code.trim());
	if (!candidate || !preservesStoryStructure(originalCode, candidate)) {
		return null;
	}

	return candidate;
}

/** The fresh data is worth more than rewritten text: a model that fails to rewrite it must not fail the whole refresh. */
async function keepCurrentTextOnFailure<T>(
	target: StoryRefreshTarget,
	rewriteText: () => Promise<T>,
	currentText: () => Promise<T>,
): Promise<T> {
	try {
		return await rewriteText();
	} catch (error) {
		logger.warn(`Live story text refresh failed, keeping the current text: ${describeError(error)}`, {
			source: 'system',
			projectId: target.projectId,
			context: { chatId: target.chatId },
		});
		return currentText();
	}
}

/** Narratives of the last successful refresh, which the cache upsert would otherwise replace. */
async function getCachedNarratives(storyId: string): Promise<StoryNarratives> {
	const cache = await storyQueries.getStoryDataCacheByStoryId(storyId);
	return cache?.analysisResults ?? {};
}

/** Narratives are rewritten from the text in the published source, never from a previous refresh, so they cannot drift. */
async function regenerateCustomStoryNarratives(
	target: StoryRefreshTarget,
	version: { id: string; title: string },
	queryData: Record<string, { data: unknown[]; columns: string[] }>,
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
			title: version.title,
			narratives: sources,
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

/** The pinned live story model, otherwise the project's default chat model, so a refresh never lands on a model the chat cannot use. */
async function resolveLiveStoryModel(target: StoryRefreshTarget) {
	const selection =
		(await resolveDefaultModelSelection(target.projectId, 'live_story')) ??
		(await resolveDefaultChatModel(target.projectId));
	if (!selection) {
		return null;
	}

	const model = await resolveProviderModel(target.projectId, selection.provider, selection.modelId, true, {
		userId: target.userId,
		projectId: target.projectId,
		chatId: target.chatId ?? undefined,
		category: 'story',
	});
	return model ? { provider: selection.provider, model } : null;
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

function preservesStoryStructure(originalCode: string, candidateCode: string): boolean {
	return (
		JSON.stringify(extractStructureTokens(originalCode)) ===
			JSON.stringify(extractStructureTokens(candidateCode)) &&
		JSON.stringify(extractHeadingTokens(originalCode)) === JSON.stringify(extractHeadingTokens(candidateCode))
	);
}

function extractStructureTokens(code: string): string[] {
	const tokenRegex = new RegExp(
		String.raw`<grid\s+${TAG_ATTRS}>|<\/grid>|<chart\s+${TAG_ATTRS}\/?>|<table\s+${TAG_ATTRS}\/?>|<filter\s+${TAG_ATTRS}\/?>`,
		'g',
	);
	return code.match(tokenRegex) ?? [];
}

function extractHeadingTokens(code: string): string[] {
	return code
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => /^#{1,6}\s+\S/.test(line));
}
