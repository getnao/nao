import { stripSqlFilterBlocks } from '@nao/shared/sql-template';
import { TAG_ATTRS } from '@nao/shared/story-segments';
import { generateText, Output } from 'ai';
import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod';

import { llmTelemetry } from '../agents/telemetry';
import { queryAppDb } from '../agents/tools/query-app-db';
import { LiveStoryRefreshPrompt } from '../components/ai/live-story-refresh-prompt';
import type { DBStoryDataCache } from '../db/abstractSchema';
import { env } from '../env';
import { renderToMarkdown } from '../lib/markdown';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import { getQueryDataFromCode } from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import { convertToTokenUsage } from '../utils/ai';
import { getDefaultModelId, resolveDefaultModelSelection, resolveProviderModel } from '../utils/llm';
import { scheduleSaveLlmInferenceRecord } from '../utils/schedule-task';
import { backfillMissingQueryData, findMissingQueryIds } from '../utils/story-query-data';
import { MAX_OUTPUT_TOKENS } from './agent';
import { resolveExcludedColumnEnforcementForProject } from './excluded-columns.service';
const MAX_RENDERED_ROWS = 60;

interface StoryRefreshTarget {
	projectId: string;
	userId: string;
	chatId: string;
}

export async function executeLiveQuery(
	chatId: string,
	queryId: string,
): Promise<{ data: unknown[]; columns: string[] }> {
	const query = await storyQueries.getSqlQueryById(chatId, queryId);
	if (!query) {
		throw new Error(`Query ${queryId} not found in chat ${chatId}`);
	}

	const projectId = await chatQueries.getChatProjectId(chatId);
	if (!projectId) {
		throw new Error('Chat project not found');
	}

	const sqlQuery = stripSqlFilterBlocks(query.sqlQuery);
	if (query.adminMode) {
		return executeAppDatabaseSql(projectId, sqlQuery);
	}

	const project = await projectQueries.retrieveProjectById(projectId);
	if (!project.path) {
		throw new Error('Project path not configured');
	}

	const envVars = await projectQueries.getEnvVars(projectId);
	return executeRawSql(sqlQuery, {
		projectFolder: project.path,
		projectId,
		databaseId: query.databaseId,
		envVars,
	});
}

export interface RefreshResult {
	queryData: Record<string, { data: unknown[]; columns: string[] }>;
}

export async function refreshStoryData(chatId: string, slug: string): Promise<RefreshResult> {
	const version = await storyQueries.getLatestVersionByChatAndSlug(chatId, slug);
	if (!version) {
		throw new Error('Story not found');
	}

	const sqlQueries = await storyQueries.getSqlQueriesFromCode(chatId, version.code);
	if (Object.keys(sqlQueries).length === 0) {
		return { queryData: {} };
	}

	const chat = await chatQueries.getChatInfo(chatId);
	if (!chat) {
		throw new Error('Chat project not found');
	}

	const hasWarehouseQueries = Object.values(sqlQueries).some((query) => !query.adminMode);
	const project = hasWarehouseQueries ? await projectQueries.retrieveProjectById(chat.projectId) : null;
	if (project && !project.path) {
		throw new Error('Project path not configured');
	}

	const queryData: Record<string, { data: unknown[]; columns: string[] }> = {};

	await Promise.all(
		Object.entries(sqlQueries).map(async ([queryId, { sqlQuery, databaseId, adminMode }]) => {
			const effectiveSql = stripSqlFilterBlocks(sqlQuery);
			if (adminMode) {
				queryData[queryId] = await executeAppDatabaseSql(chat.projectId, effectiveSql);
				return;
			}

			const projectEnvVars = await projectQueries.getEnvVars(chat.projectId);
			const result = await executeRawSql(effectiveSql, {
				projectFolder: project!.path!,
				projectId: chat.projectId,
				databaseId,
				envVars: projectEnvVars,
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

	await storyQueries.upsertStoryDataCache(chatId, slug, queryData);

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
): Promise<StoryQueryDataResult> {
	if (!isLive) {
		return { queryData: await getQueryDataFromCode(chatId, code), cachedAt: null };
	}

	const cache = await storyQueries.getStoryDataCacheByChatAndSlug(chatId, slug);

	if (cache && !isCacheExpired(cache.cachedAt, cacheSchedule)) {
		return resolveFromCache(chatId, code, cache);
	}

	try {
		const { queryData } = await refreshStoryData(chatId, slug);
		return {
			queryData: Object.keys(queryData).length > 0 ? queryData : null,
			cachedAt: new Date(),
		};
	} catch {
		if (cache) {
			return resolveFromCache(chatId, code, cache);
		}
		return { queryData: await getQueryDataFromCode(chatId, code), cachedAt: null };
	}
}

async function resolveFromCache(chatId: string, code: string, cache: DBStoryDataCache): Promise<StoryQueryDataResult> {
	const missing = findMissingQueryIds(code, cache.queryData);
	const queryData =
		missing.length > 0 ? await backfillMissingQueryData(code, cache.queryData, { chatId }) : cache.queryData;
	return { queryData, cachedAt: cache.cachedAt };
}

interface RawSqlExecutionOptions {
	projectFolder: string;
	projectId: string;
	databaseId?: string;
	envVars?: Record<string, string>;
}

export async function executeRawSql(
	sqlQuery: string,
	options: RawSqlExecutionOptions,
): Promise<{ data: unknown[]; columns: string[] }> {
	const enforceExcludedColumns = await resolveExcludedColumnEnforcementForProject(options.projectId);
	const response = await fetch(`http://localhost:${env.FASTAPI_PORT}/execute_sql`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Nao-Internal-Secret': env.BETTER_AUTH_SECRET,
		},
		body: JSON.stringify({
			sql: sqlQuery,
			nao_project_folder: options.projectFolder,
			enforce_excluded_columns: enforceExcludedColumns,
			...(options.databaseId && { database_id: options.databaseId }),
			...(options.envVars && Object.keys(options.envVars).length > 0 && { env_vars: options.envVars }),
		}),
	});

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({ detail: response.statusText }));
		throw new Error(`Error executing SQL query: ${JSON.stringify(errorData.detail)}`);
	}

	const data = await response.json();
	return { data: data.data, columns: data.columns };
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
