import { NO_CACHE_SCHEDULE } from '@nao/shared';
import type { StoryApp, StoryNarratives, StoryQueryResult } from '@nao/shared/story-app';
import type { StoryThemePair } from '@nao/shared/story-theme';

import type { DBStory, DBStoryDataCache, DBStoryVersion } from '../db/abstractSchema';
import { env } from '../env';
import * as activityQueries from '../queries/activity.queries';
import * as executeSqlQueries from '../queries/execute-sql.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyFileQueries from '../queries/story-file.queries';
import * as storyThemeQueries from '../queries/story-theme.queries';
import { isViewableStoryFile } from '../utils/story-file-path';
import { extractCustomStoryQueryIds } from '../utils/story-query-data';
import { storyHasLocalState, storyUsesState } from '../utils/story-state-usage';
import type { RefreshResult } from './live-story';
import { executeLiveQuery, isCacheExpired, refreshStoryData } from './live-story';

export interface CustomStoryVersionView {
	storyId: string;
	title: string;
	archivedAt: Date | null;
	version: { id: string; number: number; createdAt: Date };
	app: StoryApp | null;
	bundleError: string | null;
	styles: { path: string; content: string }[];
	files: CustomStoryFileSummary[];
	queryIds: string[];
	theme: StoryThemePair | null;
	isLive: boolean;
	cachedAt: Date | null;
	lastRefreshFailure: { errorMessage: string; failedAt: Date } | null;
	/** The live story was never cached or its last refresh failed: its viewer refreshes it in the background. */
	needsRefresh: boolean;
	usesState: boolean;
	hasLocalState: boolean;
}

interface CustomStoryDataOptions {
	/** Serve the stored data of a story awaiting its background refresh, instead of refreshing inline. */
	deferRefresh?: boolean;
}

export interface CustomStoryFileSummary {
	path: string;
	size: number;
}

export class CustomStoryNotFoundError extends Error {
	constructor() {
		super('Custom story not found.');
	}
}

export class CustomStoryFileNotFoundError extends Error {
	constructor(path: string) {
		super(`File ${path} is not part of this story version.`);
	}
}

export class CustomStoryQueryNotFoundError extends Error {
	constructor(queryId: string) {
		super(`Query ${queryId} was not found in this chat.`);
	}
}

export class CustomStoryQueryNotAllowedError extends Error {
	constructor(queryId: string) {
		super(`Query ${queryId} is not part of this story.`);
	}
}

/** The query itself failing is story content its viewer should read; any other failure stays an internal error. */
export class CustomStoryQueryExecutionError extends Error {}

const pendingRefreshes = new Map<string, Promise<RefreshResult>>();

export async function getCustomStoryVersion(
	chatId: string,
	storySlug: string,
	versionNumber?: number,
): Promise<CustomStoryVersionView> {
	const story = await getCustomStory(chatId, storySlug);
	const version = await getCustomStoryVersionRow(chatId, storySlug, versionNumber);
	return buildCustomStoryVersionView(story, version);
}

export async function getLatestCustomStoryVersionByStoryId(storyId: string): Promise<CustomStoryVersionView> {
	const story = await getCustomStoryById(storyId);
	const version = await storyQueries.getLatestVersionByStoryId(storyId);
	if (!version) {
		throw new CustomStoryNotFoundError();
	}
	return buildCustomStoryVersionView(story, version);
}

export async function getStandaloneCustomStoryVersion(
	storyId: string,
	versionNumber?: number,
): Promise<CustomStoryVersionView> {
	const story = await getStandaloneCustomStory(storyId);
	return buildCustomStoryVersionView(story, await getStandaloneVersionRow(storyId, versionNumber));
}

export async function getStandaloneCustomStoryFile(
	storyId: string,
	path: string,
	versionNumber?: number,
): Promise<CustomStoryFileSummary & { content: string }> {
	await getStandaloneCustomStory(storyId);
	const version = await getStandaloneVersionRow(storyId, versionNumber);
	return readVersionFile(version.id, path);
}

/** A standalone story has no chat to run its queries in: it serves the rows saved in its data cache. */
export async function getStandaloneCustomStoryQueryData(
	storyId: string,
	queryId: string,
	versionNumber?: number,
): Promise<StoryQueryResult> {
	await getStandaloneCustomStory(storyId);
	const version = await getStandaloneVersionRow(storyId, versionNumber);
	await assertQueryReferencedByVersion(version.id, queryId);
	const cache = await storyQueries.getStoryDataCacheByStoryId(storyId);
	const result = cache?.queryData?.[queryId];
	if (!result) {
		throw new CustomStoryQueryNotFoundError(queryId);
	}
	return result;
}

export async function getStandaloneCustomStoryNarratives(storyId: string): Promise<StoryNarratives> {
	await getStandaloneCustomStory(storyId);
	return (await storyQueries.getStoryDataCacheByStoryId(storyId))?.analysisResults ?? {};
}

async function buildCustomStoryVersionView(story: DBStory, version: DBStoryVersion): Promise<CustomStoryVersionView> {
	const [bundle, files, theme, cache, lastRefreshFailure] = await Promise.all([
		storyFileQueries.getVersionBundle(version.id),
		storyFileQueries.listVersionFiles(version.id),
		getActiveThemeForStory(story.id),
		story.isLive ? storyQueries.getStoryDataCacheByStoryId(story.id) : null,
		story.isLive ? activityQueries.getLatestStoryRefreshFailure(story.id) : null,
	]);
	const queryIds = [...extractCustomStoryQueryIds(files)];
	return {
		storyId: story.id,
		title: story.title,
		archivedAt: story.archivedAt,
		version: { id: version.id, number: version.version, createdAt: version.createdAt },
		app: storyFileQueries.storyAppOfBundle(bundle),
		bundleError: bundle?.bundleError ?? (bundle ? null : 'This version was never built. Publish the story again.'),
		styles: files
			.filter((file) => file.path.toLowerCase().endsWith('.css'))
			.map((file) => ({ path: file.path, content: file.content })),
		files: files
			.filter((file) => isViewableStoryFile(file.path))
			.map((file) => ({ path: file.path, size: Buffer.byteLength(file.content, 'utf8') })),
		queryIds,
		theme,
		isLive: story.isLive,
		cachedAt: cache?.cachedAt ?? null,
		lastRefreshFailure,
		needsRefresh:
			usesStoryCache(story) &&
			queryIds.length > 0 &&
			!isCacheFresh(story, cache) &&
			(cache === null || lastRefreshFailure !== null),
		usesState: storyUsesState(files),
		hasLocalState: storyHasLocalState(files),
	};
}

/** Live stories read from the story's data cache (refreshed on schedule); others from the chat's own results. */
export async function getCustomStoryQueryData(
	chatId: string,
	storySlug: string,
	queryId: string,
	options: CustomStoryDataOptions = {},
): Promise<StoryQueryResult> {
	const story = await getCustomStory(chatId, storySlug);
	if (!story.isLive) {
		return (await getChatQueryData(chatId, queryId)) ?? runStoryQuery(chatId, queryId);
	}
	if (story.cacheSchedule === NO_CACHE_SCHEDULE) {
		return runStoryQuery(chatId, queryId);
	}

	const cache = await storyQueries.getStoryDataCacheByStoryId(story.id);
	if (isCacheFresh(story, cache)) {
		return cache?.queryData?.[queryId] ?? runStoryQuery(chatId, queryId);
	}
	if (options.deferRefresh && (await isAwaitingBackgroundRefresh(story.id, cache))) {
		const stored = cache?.queryData?.[queryId] ?? (await getChatQueryData(chatId, queryId));
		return stored ?? runStoryQuery(chatId, queryId);
	}
	const queryData = await refreshOnce(chatId, storySlug).then(
		(result) => result.queryData,
		() => cache?.queryData,
	);
	return queryData?.[queryId] ?? runStoryQuery(chatId, queryId);
}

async function getChatQueryData(chatId: string, queryId: string): Promise<StoryQueryResult | undefined> {
	const stored = await executeSqlQueries.getLatestSqlQueryDataByIds(chatId, new Set([queryId]));
	return stored[queryId];
}

async function runStoryQuery(chatId: string, queryId: string): Promise<StoryQueryResult> {
	try {
		return await executeLiveQuery(chatId, queryId);
	} catch (error) {
		throw new CustomStoryQueryExecutionError(error instanceof Error ? error.message : String(error));
	}
}

export async function getCustomStoryNarratives(
	chatId: string,
	storySlug: string,
	options: CustomStoryDataOptions = {},
): Promise<StoryNarratives> {
	const story = await getCustomStory(chatId, storySlug);
	if (!story.isLive) {
		return getFrozenNarratives(story.id);
	}
	if (!story.isLiveTextDynamic) {
		return {};
	}

	const cache = await storyQueries.getStoryDataCacheByStoryId(story.id);
	const cachedNarratives = cache?.analysisResults ?? {};
	const isCacheUsable = cache && (story.cacheSchedule === NO_CACHE_SCHEDULE || isCacheFresh(story, cache));
	if (isCacheUsable) {
		return cachedNarratives;
	}
	if (options.deferRefresh && (await isAwaitingBackgroundRefresh(story.id, cache))) {
		return cachedNarratives;
	}
	return refreshOnce(chatId, storySlug).then(
		(result) => result.narratives,
		() => cachedNarratives,
	);
}

/** The results already saved for the story (its data cache, else the chat's own), without running any query. */
export async function getStoredCustomStoryQueryDataByStoryId(
	storyId: string,
	queryIds: string[],
): Promise<Record<string, StoryQueryResult>> {
	const story = await getCustomStoryById(storyId);
	const usesCache = !story.chatId || usesStoryCache(story);
	const cached = usesCache ? ((await storyQueries.getStoryDataCacheByStoryId(story.id))?.queryData ?? {}) : {};
	const uncachedIds = new Set(queryIds.filter((queryId) => !cached[queryId]));
	const fromChat =
		story.chatId && uncachedIds.size > 0
			? await executeSqlQueries.getLatestSqlQueryDataByIds(story.chatId, uncachedIds)
			: {};
	return Object.fromEntries(
		queryIds.flatMap((queryId) => {
			const result = cached[queryId] ?? fromChat[queryId];
			return result ? [[queryId, result]] : [];
		}),
	);
}

/** The narratives already saved for the story, without refreshing it. */
export async function getStoredCustomStoryNarrativesByStoryId(storyId: string): Promise<StoryNarratives> {
	const story = await getCustomStoryById(storyId);
	if (story.chatId && !story.isLive) {
		return getFrozenNarratives(story.id);
	}
	if (story.chatId && !story.isLiveTextDynamic) {
		return {};
	}
	return (await storyQueries.getStoryDataCacheByStoryId(story.id))?.analysisResults ?? {};
}

async function getFrozenNarratives(storyId: string): Promise<StoryNarratives> {
	const cache = await storyQueries.getStoryDataCacheByStoryId(storyId);
	return cache && cache.querySources === null ? (cache.analysisResults ?? {}) : {};
}

/** A shared custom story only serves the queries its own sources reference, never any other query of the chat. */
export async function getSharedCustomStoryQueryData(
	chatId: string,
	storySlug: string,
	queryId: string,
	versionNumber?: number,
): Promise<StoryQueryResult> {
	const version = await getCustomStoryVersionRow(chatId, storySlug, versionNumber);
	await assertQueryReferencedByVersion(version.id, queryId);
	return getCustomStoryQueryData(chatId, storySlug, queryId);
}

export async function getCustomStoryQuerySql(chatId: string, storySlug: string, queryId: string): Promise<string> {
	await getCustomStory(chatId, storySlug);
	const query = await storyQueries.getSqlQueryById(chatId, queryId);
	if (!query) {
		throw new CustomStoryQueryNotFoundError(queryId);
	}
	return query.sqlQuery;
}

/** Like its data, a shared custom story only reveals the SQL of queries its own sources reference. */
export async function getSharedCustomStoryQuerySql(
	chatId: string,
	storySlug: string,
	queryId: string,
	versionNumber?: number,
): Promise<string> {
	const version = await getCustomStoryVersionRow(chatId, storySlug, versionNumber);
	await assertQueryReferencedByVersion(version.id, queryId);
	return getCustomStoryQuerySql(chatId, storySlug, queryId);
}

export async function getCustomStoryFile(
	chatId: string,
	storySlug: string,
	path: string,
	versionNumber?: number,
): Promise<CustomStoryFileSummary & { content: string }> {
	await getCustomStory(chatId, storySlug);
	const version = await getCustomStoryVersionRow(chatId, storySlug, versionNumber);
	return readVersionFile(version.id, path);
}

async function readVersionFile(versionId: string, path: string): Promise<CustomStoryFileSummary & { content: string }> {
	const file = isViewableStoryFile(path) ? await storyFileQueries.getVersionFile(versionId, path) : null;
	if (!file) {
		throw new CustomStoryFileNotFoundError(path);
	}
	return { path: file.path, size: Buffer.byteLength(file.content, 'utf8'), content: file.content };
}

async function assertQueryReferencedByVersion(versionId: string, queryId: string): Promise<void> {
	const referencedIds = extractCustomStoryQueryIds(await storyFileQueries.listVersionFiles(versionId));
	if (!referencedIds.has(queryId)) {
		throw new CustomStoryQueryNotAllowedError(queryId);
	}
}

function usesStoryCache(story: DBStory): boolean {
	return story.isLive && story.cacheSchedule !== NO_CACHE_SCHEDULE;
}

function isCacheFresh(story: DBStory, cache: DBStoryDataCache | null): boolean {
	return cache !== null && !isCacheExpired(cache.cachedAt, story.cacheSchedule);
}

/** Mirrors `needsRefresh`: a stale story waits on its viewer's refresh when it was never cached or its last refresh failed. */
async function isAwaitingBackgroundRefresh(storyId: string, cache: DBStoryDataCache | null): Promise<boolean> {
	return cache === null || (await activityQueries.getLatestStoryRefreshFailure(storyId)) !== null;
}

async function getCustomStory(chatId: string, storySlug: string): Promise<DBStory> {
	const story = await storyQueries.getStoryByChatAndSlug(chatId, storySlug);
	if (!story || story.format !== 'custom') {
		throw new CustomStoryNotFoundError();
	}
	return story;
}

async function getCustomStoryById(storyId: string): Promise<DBStory> {
	const story = await storyQueries.getStoryById(storyId);
	if (!story || story.format !== 'custom') {
		throw new CustomStoryNotFoundError();
	}
	return story;
}

async function getStandaloneCustomStory(storyId: string): Promise<DBStory> {
	const story = await getCustomStoryById(storyId);
	if (story.chatId) {
		throw new CustomStoryNotFoundError();
	}
	return story;
}

async function getStandaloneVersionRow(storyId: string, versionNumber?: number) {
	const version =
		versionNumber === undefined
			? await storyQueries.getLatestVersionByStoryId(storyId)
			: await storyQueries.getVersionByStoryIdAndNumber(storyId, versionNumber);
	if (!version) {
		throw new CustomStoryNotFoundError();
	}
	return version;
}

async function getCustomStoryVersionRow(chatId: string, storySlug: string, versionNumber?: number) {
	const version =
		versionNumber === undefined
			? await storyQueries.getLatestVersionByChatAndSlug(chatId, storySlug)
			: await storyQueries.getVersionByNumber(chatId, storySlug, versionNumber);
	if (!version) {
		throw new CustomStoryNotFoundError();
	}
	return version;
}

/** Every block and narrative of a story asks at once; they share one refresh instead of each starting its own. */
function refreshOnce(chatId: string, storySlug: string): Promise<RefreshResult> {
	const key = `${chatId}:${storySlug}`;
	const pending = pendingRefreshes.get(key);
	if (pending) {
		return pending;
	}
	const refresh = refreshStoryData(chatId, storySlug).finally(() => pendingRefreshes.delete(key));
	pendingRefreshes.set(key, refresh);
	return refresh;
}

export async function getActiveThemeForStory(storyId: string): Promise<StoryThemePair | null> {
	if (!env.BETA_CUSTOM_STORIES_ENABLED) {
		return null;
	}
	const projectId = await storyQueries.getStoryProjectId(storyId);
	return projectId ? getActiveThemeForProject(projectId) : null;
}

export async function getActiveThemeForProject(projectId: string): Promise<StoryThemePair | null> {
	return env.BETA_CUSTOM_STORIES_ENABLED ? storyThemeQueries.getActiveStoryTheme(projectId) : null;
}
