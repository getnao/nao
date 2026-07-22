import { extractQueryIds } from '@nao/shared/story-segments';

import { getMcpQueryData } from '../queries/mcp-query-data.queries';
import { getQueryDataFromCode } from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';

export type StoryQueryDataMap = Record<string, { data: unknown[]; columns: string[] }>;

export type StoryQueryDataSource = { chatId: string } | { projectId: string; userId?: string };

export async function backfillMissingQueryDataForSandbox(
	code: string,
	opts: { storyId?: string; chatId?: string | null; projectId: string; userId?: string },
): Promise<StoryQueryDataMap | null> {
	const seed: StoryQueryDataMap = {};
	if (opts.storyId) {
		const cache = await storyQueries.getStoryDataCacheByStoryId(opts.storyId);
		const q = cache?.queryData as StoryQueryDataMap | undefined;
		if (q) {
			Object.assign(seed, q);
		}
	}
	if (opts.chatId) {
		const fromChat = await getQueryDataFromCode(opts.chatId, code);
		if (fromChat) {
			Object.assign(seed, fromChat);
		}
	}
	const seeded = Object.keys(seed).length > 0 ? seed : null;
	return backfillMissingQueryData(code, seeded, { projectId: opts.projectId, userId: opts.userId });
}

export function findMissingQueryIds(code: string, cachedQueryData: StoryQueryDataMap | null): string[] {
	return [...extractQueryIds(code)].filter((id) => !cachedQueryData?.[id]);
}

export async function backfillMissingQueryData(
	code: string,
	cachedQueryData: StoryQueryDataMap | null,
	source: StoryQueryDataSource,
): Promise<StoryQueryDataMap | null> {
	const missing = findMissingQueryIds(code, cachedQueryData);
	if (missing.length === 0) {
		return cachedQueryData;
	}

	const filled =
		'chatId' in source
			? await fetchFromChat(source.chatId, code, missing)
			: await fetchFromMcp(missing, source.projectId, source.userId);

	const merged = { ...(cachedQueryData ?? {}), ...filled };
	return Object.keys(merged).length > 0 ? merged : null;
}

async function fetchFromChat(chatId: string, code: string, ids: string[]): Promise<StoryQueryDataMap> {
	const fromChat = await getQueryDataFromCode(chatId, code).catch(() => null);

	const filled: StoryQueryDataMap = {};
	for (const id of ids) {
		if (fromChat?.[id]) {
			filled[id] = fromChat[id];
		}
	}
	return filled;
}

async function fetchFromMcp(ids: string[], projectId: string, userId?: string): Promise<StoryQueryDataMap> {
	const fetchOptions = userId ? { userId } : undefined;
	const rows = await Promise.all(ids.map((id) => getMcpQueryData(id, projectId, fetchOptions)));

	const filled: StoryQueryDataMap = {};
	ids.forEach((id, idx) => {
		const row = rows[idx];
		if (row) {
			filled[id] = { columns: row.columns, data: row.data };
		}
	});
	return filled;
}
