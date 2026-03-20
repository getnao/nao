import { CronExpressionParser } from 'cron-parser';

import { env } from '../env';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as storyQueries from '../queries/story.queries';
import { regenerateStoryText } from './story-text-regeneration';

export interface RefreshResult {
	queryData: Record<string, { data: unknown[]; columns: string[] }>;
	regeneratedCode: string | null;
}

export async function refreshStoryData(chatId: string, storyId: string): Promise<RefreshResult> {
	const version = await storyQueries.getLatestVersion(chatId, storyId);
	if (!version) {
		throw new Error('Story not found');
	}

	const sqlQueries = await storyQueries.collectSqlQueries(chatId, version.code);
	if (Object.keys(sqlQueries).length === 0) {
		return { queryData: {}, regeneratedCode: null };
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

	let regeneratedCode: string | null = null;
	if (version.refreshText && Object.keys(queryData).length > 0) {
		try {
			regeneratedCode = await regenerateStoryText(chatId, version.code, queryData);
		} catch (err) {
			console.error('[live-story] Text regeneration failed, keeping original text:', err);
		}
	}

	await storyQueries.upsertStoryDataCache(chatId, storyId, queryData, regeneratedCode);

	return { queryData, regeneratedCode };
}

export interface StoryQueryDataResult {
	queryData: Record<string, { data: unknown[]; columns: string[] }> | null;
	regeneratedCode: string | null;
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
		return { queryData: await collectQueryData(chatId, code), regeneratedCode: null, cachedAt: null };
	}

	const cache = await storyQueries.getStoryDataCache(chatId, storyId);

	if (cache) {
		const isCacheValid = !isCacheExpired(cache.cachedAt, cacheSchedule);

		if (isCacheValid) {
			return {
				queryData: cache.queryData,
				regeneratedCode: cache.regeneratedCode,
				cachedAt: cache.cachedAt,
			};
		}
	}

	try {
		const { queryData, regeneratedCode } = await refreshStoryData(chatId, storyId);
		return {
			queryData: Object.keys(queryData).length > 0 ? queryData : null,
			regeneratedCode,
			cachedAt: new Date(),
		};
	} catch {
		if (cache) {
			return {
				queryData: cache.queryData,
				regeneratedCode: cache.regeneratedCode,
				cachedAt: cache.cachedAt,
			};
		}
		const { collectQueryData } = await import('../queries/shared-story.queries');
		return { queryData: await collectQueryData(chatId, code), regeneratedCode: null, cachedAt: null };
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
