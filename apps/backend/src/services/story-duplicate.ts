import { NO_CACHE_SCHEDULE } from '@nao/shared';
import { extractQueryIds } from '@nao/shared/story-segments';

import type { DBStory, DBStoryDataCache, DBStoryVersion } from '../db/abstractSchema';
import { getLatestSqlQueryDataByIds } from '../queries/execute-sql.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyAppStateQueries from '../queries/story-app-state.queries';
import type { StoryFileInput } from '../queries/story-file.queries';
import * as storyFileQueries from '../queries/story-file.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import { generateStorySlug } from '../utils/story-mount';
import {
	backfillMissingQueryDataByIds,
	extractCustomStoryQueryIds,
	pickQueryData,
	type StoryQueryDataMap,
} from '../utils/story-query-data';
import { createCustomStoryDraft, publishCustomStoryDraft } from './custom-story-authoring';
import { executeLiveQuery, executeStoryLiveQuery, hasOnlyFrozenQueries, type StoryQueryResult } from './live-story';
import { updateStoryLiveSettings } from './story-refresh.service';
import { copyStoryQueries } from './story-sql-queries';

const COPY_PREFIX = 'Copy of ';
const NUMBERED_COPY_TITLE = /^Copy of (.+?)(?: \(\d{1,3}\))?$/;
const MAX_SLUG_LENGTH = 90;

interface StoryOwner {
	userId: string;
	projectId: string;
}

interface StoryCopy {
	owner: StoryOwner;
	slug: string;
	title: string;
}

interface StorySnapshot {
	queryData: StoryQueryDataMap | null;
	narratives: Record<string, string> | null;
}

export class StoryDuplicateError extends Error {}

/**
 * Copies one version of a story into a standalone story of `owner`. The copy keeps the rows and narratives the
 * version shows today, the SQL of its queries and, for a live story, its live settings, but nothing else of the
 * original (chat, shares, deliveries, favorites).
 */
export async function duplicateStory(
	source: { storyId: string; versionNumber?: number },
	owner: StoryOwner,
): Promise<{ storyId: string; title: string }> {
	const story = await storyQueries.getStoryById(source.storyId);
	if (!story) {
		throw new StoryDuplicateError('Story not found.');
	}
	const version = await loadSourceVersion(story.id, source.versionNumber);
	const title = await nextCopyTitle(owner, story.title);
	const slug = await nextStandaloneSlug(owner, title);
	const copy = { owner, slug, title };
	const copyId =
		story.format === 'custom'
			? await copyCustomStory(story, version, copy)
			: await copyClassicStory(story, version, copy);
	try {
		await placeCopyNextToSource(copyId, story.id, owner);
		await keepLiveSettings(story, copyId);
	} catch (error) {
		await storyQueries.deleteStory(copyId);
		throw error;
	}
	return { storyId: copyId, title };
}

/** A copy stays live like its source, unless none of its queries kept the SQL needed to rerun them. */
async function keepLiveSettings(source: DBStory, copyId: string): Promise<void> {
	if (!source.isLive || (await hasOnlyFrozenQueries({ id: copyId, chatId: null }))) {
		return;
	}
	await updateStoryLiveSettings(copyId, {
		isLive: true,
		isLiveTextDynamic: source.isLiveTextDynamic,
		cacheSchedule: source.cacheSchedule,
		cacheScheduleDescription: source.cacheScheduleDescription,
	});
}

async function loadSourceVersion(storyId: string, versionNumber?: number): Promise<DBStoryVersion> {
	const version =
		versionNumber === undefined
			? await storyQueries.getLatestVersionByStoryId(storyId)
			: await storyQueries.getVersionByStoryIdAndNumber(storyId, versionNumber);
	if (!version) {
		throw new StoryDuplicateError(
			versionNumber === undefined ? 'This story has no version to copy.' : `Version ${versionNumber} not found.`,
		);
	}
	return version;
}

async function copyClassicStory(source: DBStory, version: DBStoryVersion, copy: StoryCopy): Promise<string> {
	const queryIds = extractQueryIds(version.code);
	const snapshot = await loadSnapshot(source, queryIds);
	const created = await storyQueries.createStandaloneStory({
		...copy.owner,
		slug: copy.slug,
		title: copy.title,
		code: version.code,
		source: 'user',
		origin: 'copy',
	});
	if (!created) {
		throw new StoryDuplicateError('A story with the same name was just created. Try again.');
	}
	try {
		await saveSnapshot(created.id, snapshot);
		await copyStoryQueries(source, created.id, queryIds);
	} catch (error) {
		await storyQueries.deleteStory(created.id);
		throw error;
	}
	return created.id;
}

async function copyCustomStory(source: DBStory, version: DBStoryVersion, copy: StoryCopy): Promise<string> {
	const files = await listVersionFileInputs(version.id);
	const queryIds = extractCustomStoryQueryIds(files);
	const snapshot = await loadSnapshot(source, queryIds);
	const { story } = await createCustomStoryDraft({ ...copy.owner, slug: copy.slug, title: copy.title, files });
	try {
		await saveSnapshot(story.id, snapshot);
		await copyStoryQueries(source, story.id, queryIds);
		await copyAppState(source.id, story.id, copy.owner.userId);
		const published = await publishCustomStoryDraft(story, copy.owner, {
			source: 'user',
			...copyProvenance(copy.owner.userId),
		});
		if (!published.ok) {
			throw new StoryDuplicateError('This version of the story no longer builds, so it cannot be copied.');
		}
		return story.id;
	} catch (error) {
		await storyQueries.deleteStory(story.id);
		throw error;
	}
}

async function listVersionFileInputs(versionId: string): Promise<StoryFileInput[]> {
	const files = await storyFileQueries.listVersionFiles(versionId);
	return files.map((file) => ({ path: file.path, content: file.content }));
}

/** Reads the rows the source shows today: a live story reads its cache first, a chat story the queries of its chat. */
async function loadSnapshot(source: DBStory, queryIds: Set<string>): Promise<StorySnapshot> {
	const cache = await storyQueries.getStoryDataCacheByStoryId(source.id);
	const cached = pickQueryData((cache?.queryData as StoryQueryDataMap | null) ?? {}, queryIds);
	if (!source.chatId) {
		return loadStandaloneSnapshot(source, queryIds, cached, cache);
	}

	const queryData = await loadChatStoryQueryData(source, source.chatId, queryIds, cached);
	return {
		queryData: Object.keys(queryData).length > 0 ? queryData : null,
		narratives: pickShownNarratives(source, cache),
	};
}

/**
 * Mirrors how a standalone story is viewed: a live one rerun on every view reruns its queries, and live text
 * that is not dynamic is hidden. Once live is off, it keeps the text that matches the rows it last showed.
 */
async function loadStandaloneSnapshot(
	source: DBStory,
	queryIds: Set<string>,
	cached: StoryQueryDataMap,
	cache: DBStoryDataCache | null,
): Promise<StorySnapshot> {
	const isRerunOnView = source.isLive && source.cacheSchedule === NO_CACHE_SCHEDULE;
	const shown = isRerunOnView
		? { ...cached, ...(await runLiveQueries(queryIds, (queryId) => executeStoryLiveQuery(source, queryId))) }
		: cached;
	const queryData = await backfillMissingQueryDataByIds(queryIds, shown, {
		projectId: source.projectId!,
		userId: source.userId ?? undefined,
	});
	const hidesNarratives = source.isLive && !source.isLiveTextDynamic;
	return { queryData, narratives: hidesNarratives ? null : (cache?.analysisResults ?? null) };
}

/** A live story shows the text it generates, a story that is no longer live the text frozen when it was copied. */
function pickShownNarratives(source: DBStory, cache: DBStoryDataCache | null): Record<string, string> | null {
	if (!cache) {
		return null;
	}
	if (source.isLive) {
		return source.isLiveTextDynamic ? cache.analysisResults : null;
	}
	return cache.querySources === null ? cache.analysisResults : null;
}

/** Mirrors how a chat story reads its rows when viewed; a live story without cache reruns its queries. */
async function loadChatStoryQueryData(
	source: DBStory,
	chatId: string,
	queryIds: Set<string>,
	cached: StoryQueryDataMap,
): Promise<StoryQueryDataMap> {
	const fromChat = await getLatestSqlQueryDataByIds(chatId, queryIds).catch(() => ({}));
	if (!source.isLive) {
		return { ...cached, ...fromChat };
	}
	if (source.cacheSchedule !== NO_CACHE_SCHEDULE) {
		return { ...fromChat, ...cached };
	}
	return {
		...cached,
		...fromChat,
		...(await runLiveQueries(queryIds, (queryId) => executeLiveQuery(chatId, queryId))),
	};
}

async function runLiveQueries(
	queryIds: Set<string>,
	runQuery: (queryId: string) => Promise<StoryQueryResult>,
): Promise<StoryQueryDataMap> {
	const queryData: StoryQueryDataMap = {};
	await Promise.all(
		[...queryIds].map(async (queryId) => {
			const result = await runQuery(queryId).catch(() => null);
			if (result) {
				queryData[queryId] = result;
			}
		}),
	);
	return queryData;
}

async function saveSnapshot(storyId: string, snapshot: StorySnapshot): Promise<void> {
	if (!snapshot.queryData && !snapshot.narratives) {
		return;
	}
	await storyQueries.upsertStoryDataCacheByStoryId(storyId, snapshot.queryData ?? {}, snapshot.narratives);
}

/** Copies the shared state and the owner's own personal state, never another user's private state. */
async function copyAppState(sourceId: string, copyId: string, ownerId: string): Promise<void> {
	const [sharedRows, personalRows] = await Promise.all([
		storyAppStateQueries.listProjectStoryAppState(sourceId),
		storyAppStateQueries.listUserStoryAppState(sourceId, ownerId),
	]);
	for (const row of [...sharedRows, ...personalRows]) {
		await storyAppStateQueries.upsertStoryAppState(
			{ storyId: copyId, scope: row.scope, userId: row.userId, key: row.key },
			row.value,
			ownerId,
		);
	}
}

async function nextCopyTitle(owner: StoryOwner, sourceTitle: string): Promise<string> {
	const baseTitle = `${COPY_PREFIX}${NUMBERED_COPY_TITLE.exec(sourceTitle)?.[1] ?? sourceTitle}`;
	const taken = new Set(
		await storyQueries.listOwnedStoryTitlesStartingWith(owner.userId, owner.projectId, baseTitle),
	);
	return firstFreeName(baseTitle, (count) => `${baseTitle} (${count})`, taken);
}

async function nextStandaloneSlug(owner: StoryOwner, title: string): Promise<string> {
	const baseSlug = generateStorySlug(title).slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '');
	const taken = new Set(await storyQueries.listStandaloneSlugsStartingWith(owner.userId, owner.projectId, baseSlug));
	return firstFreeName(baseSlug, (count) => `${baseSlug}-${count}`, taken);
}

function firstFreeName(base: string, numbered: (count: number) => string, taken: Set<string>): string {
	if (!taken.has(base)) {
		return base;
	}
	let count = 2;
	while (taken.has(numbered(count))) {
		count++;
	}
	return numbered(count);
}

/** The copy joins the source's folder only when that folder is private to the user, so it is never shared on copy. */
async function placeCopyNextToSource(copyId: string, sourceId: string, owner: StoryOwner): Promise<void> {
	const folderId = await privateFolderOf(sourceId, owner.userId);
	if (!folderId) {
		await storyFolderQueries.saveStoryInPrivateRoot(owner.userId, owner.projectId, copyId);
		return;
	}
	await storyFolderQueries.moveStoryToFolder(copyId, folderId, {
		storyOwnerId: owner.userId,
		projectId: owner.projectId,
	});
}

async function privateFolderOf(storyId: string, userId: string): Promise<string | null> {
	const item = await storyFolderQueries.getStoryFolderItem(storyId);
	const folder = item ? await storyFolderQueries.getFolderById(item.folderId) : null;
	const isPrivateToUser = folder?.ownerId === userId && folder.visibility === 'private' && !folder.archivedAt;
	return isPrivateToUser ? folder.id : null;
}

function copyProvenance(authorId: string): storyQueries.VersionProvenance {
	return { origin: 'copy', authorId, sourceChatId: null };
}
