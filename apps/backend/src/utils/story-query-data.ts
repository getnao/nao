import { getMcpQueryData } from '../queries/mcp-query-data.queries';
import { getQueryDataFromCode } from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';

export type StoryQueryDataMap = Record<string, { data: unknown[]; columns: string[] }>;

export async function resolveStoryQueryDataForSandbox(
	code: string,
	opts: { storyId?: string; chatId?: string | null; projectId: string },
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
	return resolveStoryQueryData(code, seeded, opts.projectId);
}

export async function resolveStoryQueryData(
	code: string,
	cachedQueryData: StoryQueryDataMap | null,
	projectId: string,
): Promise<StoryQueryDataMap | null> {
	const referencedIds = extractQueryIdsFromStoryCode(code);
	if (referencedIds.size === 0) {
		return cachedQueryData;
	}

	const merged: StoryQueryDataMap = { ...(cachedQueryData ?? {}) };
	const missing = [...referencedIds].filter((id) => !merged[id]);
	if (missing.length === 0) {
		return merged;
	}

	const fetched = await Promise.all(missing.map((id) => getMcpQueryData(id, projectId)));
	missing.forEach((id, idx) => {
		const row = fetched[idx];
		if (row) {
			merged[id] = { columns: row.columns, data: row.data };
		}
	});

	return Object.keys(merged).length > 0 ? merged : null;
}

function extractQueryIdsFromStoryCode(code: string): Set<string> {
	const ids = new Set<string>();
	const regex = /<(?:chart|table)\s+[^>]*?\bquery_id\s*=\s*"([^"]+)"/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(code)) !== null) {
		ids.add(match[1]);
	}
	return ids;
}
