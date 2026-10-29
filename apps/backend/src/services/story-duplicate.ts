import { extractQueryIds } from '@nao/shared/story-segments';

import type { DBStory, DBStoryVersion } from '../db/abstractSchema';
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
 * Copies one version of a story into a standalone story of `owner`. The copy is a frozen snapshot: it keeps the rows
 * and narratives the version shows today, and nothing else of the original (chat, shares, schedules, favorites).
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
	await placeCopyNextToSource(copyId, story.id, owner);
	return { storyId: copyId, title };
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
	const snapshot = await loadSnapshot(source, extractQueryIds(version.code));
	const created = await storyQueries.createStandaloneStory({
		...copy.owner,
		slug: copy.slug,
		title: copy.title,
		code: version.code,
		source: 'user',
	});
	if (!created) {
		throw new StoryDuplicateError('A story with the same name was just created. Try again.');
	}
	await saveSnapshot(created.id, snapshot);
	return created.id;
}

async function copyCustomStory(source: DBStory, version: DBStoryVersion, copy: StoryCopy): Promise<string> {
	const files = await listVersionFileInputs(version.id);
	const snapshot = await loadSnapshot(source, extractCustomStoryQueryIds(files));
	const { story } = await createCustomStoryDraft({ ...copy.owner, slug: copy.slug, title: copy.title, files });
	try {
		await saveSnapshot(story.id, snapshot);
		await copySharedAppState(source.id, story.id, copy.owner.userId);
		const published = await publishCustomStoryDraft(story, copy.owner, 'user');
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
		const queryData = await backfillMissingQueryDataByIds(queryIds, cached, {
			projectId: source.projectId!,
			userId: source.userId ?? undefined,
		});
		return { queryData, narratives: cache?.analysisResults ?? null };
	}

	const fromChat = await getLatestSqlQueryDataByIds(source.chatId, queryIds).catch(() => ({}));
	const queryData = source.isLive ? { ...fromChat, ...cached } : { ...cached, ...fromChat };
	return {
		queryData: Object.keys(queryData).length > 0 ? queryData : null,
		narratives: source.isLive && source.isLiveTextDynamic ? (cache?.analysisResults ?? null) : null,
	};
}

async function saveSnapshot(storyId: string, snapshot: StorySnapshot): Promise<void> {
	if (!snapshot.queryData && !snapshot.narratives) {
		return;
	}
	await storyQueries.upsertStoryDataCacheByStoryId(storyId, snapshot.queryData ?? {}, snapshot.narratives);
}

async function copySharedAppState(sourceId: string, copyId: string, ownerId: string): Promise<void> {
	const rows = await storyAppStateQueries.listProjectStoryAppState(sourceId);
	for (const row of rows) {
		await storyAppStateQueries.upsertStoryAppState(
			{ storyId: copyId, scope: 'project', userId: null, key: row.key },
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
