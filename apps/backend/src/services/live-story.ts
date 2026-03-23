import { CronExpressionParser } from 'cron-parser';

import { env } from '../env';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as storyQueries from '../queries/story.queries';
import { generateAnalyses, parseAnalysisBlocks } from './story-analysis';

export const NO_CACHE_SCHEDULE = 'no-cache';

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
	analysisResults: Record<string, string> | null;
}

export async function refreshStoryData(chatId: string, storyId: string): Promise<RefreshResult> {
	const version = await storyQueries.getLatestVersion(chatId, storyId);
	if (!version) {
		throw new Error('Story not found');
	}

	const sqlQueries = await storyQueries.collectSqlQueries(chatId, version.code);
	if (Object.keys(sqlQueries).length === 0) {
		return { queryData: {}, analysisResults: null };
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

	let analysisResults: Record<string, string> | null = null;
	const hasAnalysisBlocks = parseAnalysisBlocks(version.code).length > 0;
	if (hasAnalysisBlocks && Object.keys(queryData).length > 0) {
		try {
			analysisResults = await generateAnalyses(chatId, version.code, queryData);
		} catch (err) {
			console.error('[live-story] Analysis generation failed:', err);
		}
	}

	await storyQueries.upsertStoryDataCache(chatId, storyId, queryData, analysisResults);

	return { queryData, analysisResults };
}

export interface StoryQueryDataResult {
	queryData: Record<string, { data: unknown[]; columns: string[] }> | null;
	analysisResults: Record<string, string> | null;
	cachedAt: Date | null;
}

export async function getStoryQueryData(
	chatId: string,
	storyId: string,
	code: string,
	isLive: boolean,
	cacheSchedule: string | null,
): Promise<StoryQueryDataResult> {
	if (!isLive) {
		const { collectQueryData } = await import('../queries/shared-story.queries');
		return { queryData: await collectQueryData(chatId, code), analysisResults: null, cachedAt: null };
	}

	const cache = await storyQueries.getStoryDataCache(chatId, storyId);

	if (cache) {
		const isCacheValid = !isCacheExpired(cache.cachedAt, cacheSchedule);

		if (isCacheValid) {
			return {
				queryData: cache.queryData,
				analysisResults: cache.analysisResults,
				cachedAt: cache.cachedAt,
			};
		}
	}

	try {
		const { queryData, analysisResults } = await refreshStoryData(chatId, storyId);
		return {
			queryData: Object.keys(queryData).length > 0 ? queryData : null,
			analysisResults,
			cachedAt: new Date(),
		};
	} catch {
		if (cache) {
			return {
				queryData: cache.queryData,
				analysisResults: cache.analysisResults,
				cachedAt: cache.cachedAt,
			};
		}
		const { collectQueryData } = await import('../queries/shared-story.queries');
		return { queryData: await collectQueryData(chatId, code), analysisResults: null, cachedAt: null };
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
