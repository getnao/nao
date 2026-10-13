import { extractQueryIds } from '@nao/shared/story-segments';
import type { StorySummary, SummarySegment } from '@nao/shared/types';

import { getLatestSqlQueryDataByChats } from '../queries/execute-sql.queries';
import { getMcpQueryData } from '../queries/mcp-query-data.queries';
import { getQueryDataFromCode } from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';

export type StoryQueryDataMap = Record<string, { data: unknown[]; columns: string[] }>;

export type StoryQueryDataSource = { chatId: string } | { projectId: string; userId?: string };

const CUSTOM_STORY_QUERY_ID_PATTERN = /\bquery_[A-Za-z0-9_-]+/g;

export function extractCustomStoryQueryIds(files: { content: string }[]): Set<string> {
	const ids = new Set<string>();
	for (const file of files) {
		for (const match of file.content.matchAll(CUSTOM_STORY_QUERY_ID_PATTERN)) {
			ids.add(match[0]);
		}
	}
	return ids;
}

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

interface KpiPreviewSource {
	chatId?: string | null;
	isLive?: boolean;
	summary: StorySummary;
}

export async function withKpiPreviewData<T extends KpiPreviewSource>(
	stories: T[],
	storyIdOf: (story: T) => string,
): Promise<(T & { kpiPreviewData: StoryQueryDataMap | null })[]> {
	const queryIdsByStory = new Map(
		stories.map((story) => [storyIdOf(story), collectKpiQueryIds(story.summary.segments)]),
	);
	const previewedStoryIds = [...queryIdsByStory].filter(([, ids]) => ids.size > 0).map(([storyId]) => storyId);
	const cachedByStoryId = await storyQueries.getStoryQueryDataByStoryIds(previewedStoryIds);
	const plans = stories.map((story) => {
		const queryIds = queryIdsByStory.get(storyIdOf(story)) ?? new Set<string>();
		const fromCache = pickQueryData(cachedByStoryId.get(storyIdOf(story)) ?? {}, queryIds);
		return { story, fromCache, idsFromChat: idsToReadFromChat(story, queryIds, fromCache) };
	});
	const chatResults = await getLatestSqlQueryDataByChats(groupIdsByChat(plans)).catch(() => new Map());
	return plans.map(({ story, fromCache, idsFromChat }) => {
		const fromChat = story.chatId ? pickQueryData(chatResults.get(story.chatId) ?? {}, idsFromChat) : {};
		return { ...story, kpiPreviewData: latestRowOnly({ ...fromCache, ...fromChat }) };
	});
}

function idsToReadFromChat(story: KpiPreviewSource, queryIds: Set<string>, fromCache: StoryQueryDataMap): Set<string> {
	if (!story.chatId) {
		return new Set();
	}
	return story.isLive === false ? queryIds : new Set([...queryIds].filter((id) => !fromCache[id]));
}

function groupIdsByChat(plans: { story: KpiPreviewSource; idsFromChat: Set<string> }[]): Map<string, Set<string>> {
	const idsByChat = new Map<string, Set<string>>();
	for (const { story, idsFromChat } of plans) {
		if (!story.chatId || idsFromChat.size === 0) {
			continue;
		}
		const chatIds = idsByChat.get(story.chatId) ?? new Set<string>();
		idsFromChat.forEach((id) => chatIds.add(id));
		idsByChat.set(story.chatId, chatIds);
	}
	return idsByChat;
}

function collectKpiQueryIds(segments: SummarySegment[]): Set<string> {
	const ids = new Set<string>();
	for (const segment of segments) {
		if (segment.type === 'chart' && segment.chartType === 'kpi_card' && segment.queryId) {
			ids.add(segment.queryId);
		}
		if (segment.type === 'grid') {
			collectKpiQueryIds(segment.children).forEach((id) => ids.add(id));
		}
	}
	return ids;
}

function pickQueryData(queryData: StoryQueryDataMap, queryIds: Set<string>): StoryQueryDataMap {
	return Object.fromEntries(Object.entries(queryData).filter(([id]) => queryIds.has(id)));
}

function latestRowOnly(queryData: StoryQueryDataMap): StoryQueryDataMap | null {
	const entries = Object.entries(queryData).map(([id, result]) => [
		id,
		{ columns: result.columns, data: result.data.slice(-1) },
	]);
	return entries.length > 0 ? Object.fromEntries(entries) : null;
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
