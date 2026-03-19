import { env } from '../env';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as storyQueries from '../queries/story.queries';

export async function refreshStoryData(
	chatId: string,
	storyId: string,
): Promise<Record<string, { data: unknown[]; columns: string[] }>> {
	const version = await storyQueries.getLatestVersion(chatId, storyId);
	if (!version) {
		throw new Error('Story not found');
	}

	const sqlQueries = await storyQueries.collectSqlQueries(chatId, version.code);
	if (Object.keys(sqlQueries).length === 0) {
		return {};
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

	await storyQueries.upsertStoryDataCache(chatId, storyId, queryData);

	return queryData;
}

export async function getStoryQueryData(
	chatId: string,
	storyId: string,
	code: string,
	isLive: boolean,
	cacheTtlMinutes: number | null,
): Promise<{ queryData: Record<string, { data: unknown[]; columns: string[] }> | null; cachedAt: Date | null }> {
	if (!isLive) {
		const { collectQueryData } = await import('../queries/shared-story.queries');
		return { queryData: await collectQueryData(chatId, code), cachedAt: null };
	}

	const cache = await storyQueries.getStoryDataCache(chatId, storyId);

	if (cache) {
		const isCacheValid =
			cacheTtlMinutes === null || Date.now() - cache.cachedAt.getTime() < cacheTtlMinutes * 60 * 1000;

		if (isCacheValid) {
			return { queryData: cache.queryData, cachedAt: cache.cachedAt };
		}
	}

	try {
		const queryData = await refreshStoryData(chatId, storyId);
		return {
			queryData: Object.keys(queryData).length > 0 ? queryData : null,
			cachedAt: new Date(),
		};
	} catch {
		if (cache) {
			return { queryData: cache.queryData, cachedAt: cache.cachedAt };
		}
		const { collectQueryData } = await import('../queries/shared-story.queries');
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
