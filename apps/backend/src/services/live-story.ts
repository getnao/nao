import { createHash } from 'node:crypto';

import { stripSqlFilterBlocks } from '@nao/shared/sql-template';
import { TAG_ATTRS } from '@nao/shared/story-segments';
import { extractQueryIds } from '@nao/shared/story-segments';
import { LOCAL_DATABASE_ID } from '@nao/shared/tools';
import { generateText, Output } from 'ai';
import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod';

import { llmTelemetry } from '../agents/telemetry';
import { queryAppDb } from '../agents/tools/query-app-db';
import { LiveStoryRefreshPrompt } from '../components/ai/live-story-refresh-prompt';
import type { DBStoryDataCache } from '../db/abstractSchema';
import { renderToMarkdown } from '../lib/markdown';
import * as chatQueries from '../queries/chat.queries';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import { getQueryDataFromCode } from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import type { StoryQuerySources } from '../types/story-cache';
import type { McpToolContext } from '../types/tools';
import { convertToTokenUsage } from '../utils/ai';
import { getDefaultModelId, resolveDefaultModelSelection, resolveProviderModel } from '../utils/llm';
import { scheduleSaveLlmInferenceRecord } from '../utils/schedule-task';
import { backfillMissingQueryData, findMissingQueryIds } from '../utils/story-query-data';
import { buildMcpToolContext, MAX_OUTPUT_TOKENS } from './agent';
import { resolveExcludedColumnEnforcement } from './excluded-columns.service';
import { executeWarehouseSql, validateWarehouseSql, WarehouseSqlError } from './warehouse-sql.service';
const MAX_RENDERED_ROWS = 60;

interface StoryRefreshTarget {
	projectId: string;
	userId: string;
	chatId: string;
}

export async function executeLiveQuery(
	chatId: string,
	queryId: string,
	principalUserId: string,
): Promise<{ data: unknown[]; columns: string[] }> {
	const query = await storyQueries.getSqlQueryById(chatId, queryId);
	if (!query) {
		throw new Error(`Query ${queryId} not found in chat ${chatId}`);
	}

	const sqlQuery = stripSqlFilterBlocks(query.sqlQuery);
	if (query.adminMode) {
		const projectId = await requireChatProjectId(chatId);
		return executeAppDatabaseSql(projectId, sqlQuery);
	}

	const executionContext = await createStoryExecutionContext(chatId, principalUserId);
	return executeRawSql(sqlQuery, {
		executionContext,
		databaseId: query.databaseId,
	});
}

export interface RefreshResult {
	queryData: Record<string, { data: unknown[]; columns: string[] }>;
}

export async function refreshStoryData(chatId: string, slug: string, principalUserId: string): Promise<RefreshResult> {
	const executionContext = await createStoryExecutionContext(chatId, principalUserId);
	return refreshStoryDataWithContext(chatId, slug, executionContext);
}

async function refreshStoryDataWithContext(
	chatId: string,
	slug: string,
	executionContext: StoryExecutionContext,
): Promise<RefreshResult> {
	const version = await storyQueries.getLatestVersionByChatAndSlug(chatId, slug);
	if (!version) {
		throw new Error('Story not found');
	}

	const sqlQueries = await storyQueries.getSqlQueriesFromCode(chatId, version.code);
	if (executionContext.toolContext.warehouseTableAccess.enforced) {
		assertAllStoryQueriesResolved(version.code, sqlQueries);
	}
	if (Object.keys(sqlQueries).length === 0) {
		return { queryData: {} };
	}

	const chat = await chatQueries.getChatInfo(chatId);
	if (!chat) {
		throw new Error('Chat project not found');
	}

	const queryData: Record<string, { data: unknown[]; columns: string[] }> = {};

	await Promise.all(
		Object.entries(sqlQueries).map(async ([queryId, { sqlQuery, databaseId, adminMode }]) => {
			const effectiveSql = stripSqlFilterBlocks(sqlQuery);
			if (adminMode) {
				queryData[queryId] = await executeAppDatabaseSql(chat.projectId, effectiveSql);
				return;
			}

			const result = await executeRawSql(effectiveSql, {
				executionContext,
				databaseId,
			});
			queryData[queryId] = result;
		}),
	);

	if (version.isLiveTextDynamic) {
		const newCode = await generateDynamicStoryCode(
			{ projectId: chat.projectId, userId: chat.userId, chatId },
			version.title,
			version.code,
			queryData,
		);
		if (newCode) {
			await storyQueries.updateLatestVersionCode(chatId, slug, newCode);
		}
	}

	await storyQueries.upsertStoryDataCache(chatId, slug, queryData, buildQuerySources(sqlQueries));

	return { queryData };
}

export interface StoryQueryDataResult {
	queryData: Record<string, { data: unknown[]; columns: string[] }> | null;
	cachedAt: Date | null;
}

export async function getStoryQueryData(
	chatId: string,
	slug: string,
	code: string,
	isLive: boolean,
	cacheSchedule: string | null,
	principalUserId: string,
): Promise<StoryQueryDataResult> {
	if (!isLive) {
		return { queryData: await getQueryDataFromCode(chatId, code), cachedAt: null };
	}

	const executionContext = await createStoryExecutionContext(chatId, principalUserId);
	const sqlQueries = await storyQueries.getSqlQueriesFromCode(chatId, code);
	const cache = await storyQueries.getStoryDataCacheByChatAndSlug(chatId, slug);
	const enforced = executionContext.toolContext.warehouseTableAccess.enforced;
	const allQueriesResolved = areAllStoryQueriesResolved(code, sqlQueries);
	if (enforced && !allQueriesResolved) {
		throw new Error('Live Story query sources could not be resolved.');
	}
	const querySources = buildQuerySources(sqlQueries);
	const cacheMatchesCurrentSources =
		cache !== null && allQueriesResolved && doesCacheMatchCurrentSources(code, cache, querySources);

	if (cache && !isCacheExpired(cache.cachedAt, cacheSchedule) && (!enforced || cacheMatchesCurrentSources)) {
		await validateCachedWarehouseSources(sqlQueries, executionContext);
		return enforced ? resolveValidatedCache(code, cache) : resolveLegacyCache(chatId, code, cache);
	}

	try {
		const { queryData } = await refreshStoryDataWithContext(chatId, slug, executionContext);
		return {
			queryData: Object.keys(queryData).length > 0 ? queryData : null,
			cachedAt: new Date(),
		};
	} catch (error) {
		if (enforced && !cacheMatchesCurrentSources) {
			throw error;
		}
		await validateCachedWarehouseSources(sqlQueries, executionContext);
		if (cache) {
			return enforced ? resolveValidatedCache(code, cache) : resolveLegacyCache(chatId, code, cache);
		}
		if (enforced) {
			throw error;
		}
		return { queryData: await getQueryDataFromCode(chatId, code), cachedAt: null };
	}
}

function resolveValidatedCache(code: string, cache: DBStoryDataCache): StoryQueryDataResult {
	const queryData = selectCurrentQueryData(code, cache.queryData);
	return { queryData, cachedAt: cache.cachedAt };
}

async function resolveLegacyCache(
	chatId: string,
	code: string,
	cache: DBStoryDataCache,
): Promise<StoryQueryDataResult> {
	const missing = findMissingQueryIds(code, cache.queryData);
	const queryData =
		missing.length > 0 ? await backfillMissingQueryData(code, cache.queryData, { chatId }) : cache.queryData;
	return { queryData, cachedAt: cache.cachedAt };
}

type StorySqlQueries = Awaited<ReturnType<typeof storyQueries.getSqlQueriesFromCode>>;

function assertAllStoryQueriesResolved(code: string, sqlQueries: StorySqlQueries): void {
	if (!areAllStoryQueriesResolved(code, sqlQueries)) {
		throw new Error('Live Story query sources could not be resolved.');
	}
}

function areAllStoryQueriesResolved(code: string, sqlQueries: StorySqlQueries): boolean {
	return [...extractQueryIds(code)].every((queryId) => Object.hasOwn(sqlQueries, queryId));
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

function doesCacheMatchCurrentSources(
	code: string,
	cache: DBStoryDataCache,
	currentSources: StoryQuerySources,
): boolean {
	if (!cache.querySources) {
		return false;
	}
	return [...extractQueryIds(code)].every((queryId) => {
		const cachedSource = cache.querySources?.[queryId];
		const currentSource = currentSources[queryId];
		return (
			cache.queryData[queryId] !== undefined &&
			cachedSource !== undefined &&
			currentSource !== undefined &&
			cachedSource.fingerprint === currentSource.fingerprint &&
			cachedSource.databaseId === currentSource.databaseId &&
			cachedSource.adminMode === currentSource.adminMode
		);
	});
}

function selectCurrentQueryData(
	code: string,
	queryData: Record<string, { data: unknown[]; columns: string[] }>,
): Record<string, { data: unknown[]; columns: string[] }> | null {
	const selected = Object.fromEntries(
		[...extractQueryIds(code)].flatMap((queryId) =>
			queryData[queryId] === undefined ? [] : [[queryId, queryData[queryId]]],
		),
	);
	return Object.keys(selected).length > 0 ? selected : null;
}

export interface StoryExecutionContext {
	toolContext: McpToolContext;
	enforceExcludedColumns: boolean;
}

interface RawSqlExecutionOptions {
	executionContext: StoryExecutionContext;
	databaseId?: string;
}

export async function executeRawSql(
	sqlQuery: string,
	options: RawSqlExecutionOptions,
): Promise<{ data: unknown[]; columns: string[] }> {
	const context = options.executionContext.toolContext;
	const data = await executeWarehouseSql(sqlQuery, {
		projectFolder: context.projectFolder,
		databaseId: options.databaseId,
		envVars: context.envVars,
		azureAccessToken: context.azureAccessToken,
		enforceExcludedColumns: options.executionContext.enforceExcludedColumns,
		tableAccess: context.warehouseTableAccess,
	});
	return { data: data.data, columns: data.columns };
}

export async function createStoryExecutionContext(
	chatId: string,
	principalUserId: string,
): Promise<StoryExecutionContext> {
	const projectId = await requireChatProjectId(chatId);
	const toolContext = await buildMcpToolContext({ projectId, userId: principalUserId });
	return {
		toolContext,
		enforceExcludedColumns: await resolveExcludedColumnEnforcement(toolContext.agentSettings),
	};
}

async function validateWarehouseSources(
	sqlQueries: Awaited<ReturnType<typeof storyQueries.getSqlQueriesFromCode>>,
	executionContext: StoryExecutionContext,
): Promise<void> {
	const context = executionContext.toolContext;
	await Promise.all(
		Object.values(sqlQueries)
			.filter((query) => !query.adminMode && query.databaseId !== LOCAL_DATABASE_ID)
			.map((query) =>
				validateWarehouseSql(stripSqlFilterBlocks(query.sqlQuery), {
					projectFolder: context.projectFolder,
					databaseId: query.databaseId,
					envVars: context.envVars,
					azureAccessToken: context.azureAccessToken,
					enforceExcludedColumns: executionContext.enforceExcludedColumns,
					tableAccess: context.warehouseTableAccess,
				}),
			),
	);
}

async function validateCachedWarehouseSources(
	sqlQueries: Awaited<ReturnType<typeof storyQueries.getSqlQueriesFromCode>>,
	executionContext: StoryExecutionContext,
): Promise<void> {
	try {
		await validateWarehouseSources(sqlQueries, executionContext);
	} catch (error) {
		const isRestricted = executionContext.toolContext.warehouseTableAccess.enforced;
		const isExistingGuardDenial =
			error instanceof WarehouseSqlError && (error.status === 400 || error.status === 422);
		if (isRestricted || isExistingGuardDenial) {
			throw error;
		}
	}
}

async function requireChatProjectId(chatId: string): Promise<string> {
	const projectId = await chatQueries.getChatProjectId(chatId);
	if (!projectId) {
		throw new Error('Chat project not found');
	}
	return projectId;
}

async function executeAppDatabaseSql(
	projectId: string,
	sqlQuery: string,
): Promise<{ data: unknown[]; columns: string[] }> {
	const { columns, rows } = await queryAppDb(projectId, sqlQuery);
	return { data: rows, columns };
}

function isCacheExpired(cachedAt: Date, cacheSchedule: string | null): boolean {
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
	const { projectId } = target;
	const pinned = await resolveDefaultModelSelection(projectId, 'live_story');
	const provider = pinned?.provider ?? (await llmConfigQueries.getProjectModelProvider(projectId));
	if (!provider) {
		return null;
	}

	const modelId = pinned?.modelId ?? getDefaultModelId(provider);
	const model = await resolveProviderModel(projectId, provider, modelId);
	if (!model) {
		return null;
	}

	try {
		const querySummaries = buildQueryDataSummary(queryData);
		const systemPrompt = renderToMarkdown(LiveStoryRefreshPrompt({ title, originalCode, querySummaries }));

		const { output, usage } = await generateText({
			...model,
			system: systemPrompt,
			messages: [{ role: 'user', content: 'Refresh the story narrative with the latest query results.' }],
			output: Output.object({
				schema: z.object({
					code: z.string().min(1),
				}),
			}),
			maxOutputTokens: MAX_OUTPUT_TOKENS,
			experimental_telemetry: llmTelemetry('nao-live-story', { projectId, tags: [provider] }),
		});

		scheduleSaveLlmInferenceRecord({
			type: 'live_story_refresh',
			projectId,
			userId: target.userId,
			chatId: target.chatId,
			llmProvider: provider,
			llmModelId: model.model.modelId,
			...convertToTokenUsage(usage),
		});

		const candidate = stripCodeFence(output.code.trim());
		if (!candidate || !preservesStoryStructure(originalCode, candidate)) {
			return null;
		}

		return candidate;
	} catch (error) {
		throw error instanceof Error ? error : new Error(String(error));
	}
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
