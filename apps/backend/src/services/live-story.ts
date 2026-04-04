import { generateText, Output } from 'ai';
import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod';

import { LiveStoryRefreshPrompt } from '../components/ai/live-story-refresh-prompt';
import { env } from '../env';
import { renderToMarkdown } from '../lib/markdown';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import { collectQueryData } from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import { getDefaultModelId, resolveProviderModel } from '../utils/llm';
import { MAX_OUTPUT_TOKENS } from './agent';
const MAX_RENDERED_ROWS = 60;

export async function executeLiveQuery(
	chatId: string,
	queryId: string,
): Promise<{ data: unknown[]; columns: string[] }> {
	const query = await storyQueries.findSqlQueryById(chatId, queryId);
	if (!query) {
		throw new Error(`Query ${queryId} not found in chat ${chatId}`);
	}

	const projectId = await chatQueries.getChatProjectId(chatId);
	if (!projectId) {
		throw new Error('Chat project not found');
	}

	const project = await projectQueries.retrieveProjectById(projectId);
	if (!project.path) {
		throw new Error('Project path not configured');
	}

	return executeRawSql(query.sqlQuery, project.path, query.databaseId);
}

export interface RefreshResult {
	queryData: Record<string, { data: unknown[]; columns: string[] }>;
}

export async function refreshStoryData(chatId: string, slug: string): Promise<RefreshResult> {
	const version = await storyQueries.getLatestVersion(chatId, slug);
	if (!version) {
		throw new Error('Story not found');
	}

	const sqlQueries = await storyQueries.collectSqlQueries(chatId, version.code);
	if (Object.keys(sqlQueries).length === 0) {
		return { queryData: {} };
	}

	const projectId = await chatQueries.getChatProjectId(chatId);
	if (!projectId) {
		throw new Error('Chat project not found');
	}

	const project = await projectQueries.retrieveProjectById(projectId);
	if (!project.path) {
		throw new Error('Project path not configured');
	}

	const queryData: Record<string, { data: unknown[]; columns: string[] }> = {};

	await Promise.all(
		Object.entries(sqlQueries).map(async ([queryId, { sqlQuery, databaseId }]) => {
			const result = await executeRawSql(sqlQuery, project.path!, databaseId);
			queryData[queryId] = result;
		}),
	);

	if (version.isLiveTextDynamic) {
		const newCode = await generateDynamicStoryCode(projectId, version.title, version.code, queryData);
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
		return { queryData: await collectQueryData(chatId, code), cachedAt: null };
	}

	const cache = await storyQueries.getStoryDataCache(chatId, slug);

	if (cache && !isCacheExpired(cache.cachedAt, cacheSchedule)) {
		return { queryData: cache.queryData, cachedAt: cache.cachedAt };
	}

	try {
		const { queryData } = await refreshStoryData(chatId, slug);
		return {
			queryData: Object.keys(queryData).length > 0 ? queryData : null,
			cachedAt: new Date(),
		};
	} catch {
		if (cache) {
			return { queryData: cache.queryData, cachedAt: cache.cachedAt };
		}
		return { queryData: await collectQueryData(chatId, code), cachedAt: null };
	}
}

async function executeRawSql(
	sqlQuery: string,
	projectFolder: string,
	databaseId?: string,
): Promise<{ data: unknown[]; columns: string[] }> {
	const response = await fetch(`http://localhost:${env.FASTAPI_PORT}/execute_sql`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			sql: sqlQuery,
			nao_project_folder: projectFolder,
			...(databaseId && { database_id: databaseId }),
		}),
	});

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({ detail: response.statusText }));
		throw new Error(`Error executing SQL query: ${JSON.stringify(errorData.detail)}`);
	}

	const data = await response.json();
	return { data: data.data, columns: data.columns };
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
	projectId: string,
	title: string,
	originalCode: string,
	queryData: Record<string, { data: unknown[]; columns: string[] }>,
): Promise<string | null> {
	const provider = await llmConfigQueries.getProjectModelProvider(projectId);
	if (!provider) {
		return null;
	}

	const model = await resolveProviderModel(projectId, provider, getDefaultModelId(provider));
	if (!model) {
		return null;
	}

	try {
		const querySummaries = buildQueryDataSummary(queryData);
		const systemPrompt = renderToMarkdown(LiveStoryRefreshPrompt({ title, originalCode, querySummaries }));

		const { output } = await generateText({
			...model,
			system: systemPrompt,
			messages: [{ role: 'user', content: 'Refresh the story narrative with the latest query results.' }],
			output: Output.object({
				schema: z.object({
					code: z.string().min(1),
				}),
			}),
			maxOutputTokens: MAX_OUTPUT_TOKENS,
		});

		const candidate = stripCodeFence(output.code.trim());
		if (!candidate || !preservesStoryStructure(originalCode, candidate)) {
			return null;
		}

		return candidate;
	} catch {
		return null;
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
	return code.match(/<grid\s+[^>]*>|<\/grid>|<chart\s+[^/>]*\/?>|<table\s+[^/>]*\/?>/g) ?? [];
}

function extractHeadingTokens(code: string): string[] {
	return code
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => /^#{1,6}\s+\S/.test(line));
}
