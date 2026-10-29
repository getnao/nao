import {
	extractStoryFolderReferenceIds,
	extractStoryReferenceIds,
	replaceStoryAndFolderReferences,
	toStoryFolderMentionId,
	toStoryReferenceMentionId,
} from '@nao/shared';
import { extractQueryIds } from '@nao/shared/story-segments';

import { ReferencedStoriesPrompt } from '../components/ai/referenced-story-prompt';
import { renderToMarkdown } from '../lib/markdown';
import * as analyticsEventQueries from '../queries/analytics-event.queries';
import type { StoredSqlQuery } from '../queries/execute-sql.queries';
import * as executeSqlQueries from '../queries/execute-sql.queries';
import * as storyFileQueries from '../queries/story-file.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import * as storyReferenceQueries from '../queries/story-reference.queries';
import type { UIMessage, UIMessagePart } from '../types/chat';
import type { StoryDetails, StoryFile, StoryQuery, StorySummary } from '../types/story-reference';
import { logger } from '../utils/logger';
import { isViewableStoryFile } from '../utils/story-file-path';
import { toStoryLibraryVirtualPath } from '../utils/story-library';
import { extractCustomStoryQueryIds } from '../utils/story-query-data';
import { truncateMiddle } from '../utils/utils';

export type StoryReferenceScope = { userId: string; projectId: string };

type MessageLike = Omit<UIMessage, 'id'>;

type ExpansionState = { expandedStoryIds: Set<string>; remainingLength: number };

type FolderReference = { name: string; storyIds: string[]; isPartial: boolean };

/** References past the caps are not loaded, so a message mentioning many stories stays cheap to expand. */
type References = {
	stories: Map<string, StoryDetails>;
	folders: Map<string, FolderReference>;
	skippedStoryIds: Set<string>;
	skippedFolderIds: Set<string>;
};

const MAX_REFERENCED_STORIES = 100;
const MAX_REFERENCED_FOLDERS = 10;
const MAX_CODE_LENGTH = 20_000;
const MAX_FILES_LENGTH = 30_000;
const MAX_REFERENCED_CONTENT_LENGTH = 100_000;
const MAX_TRUSTED_STORIES_IN_PROMPT = 20;
const MAX_STORIES_PER_FOLDER_REFERENCE = 20;
const MOST_VIEWED_PERIOD_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_MOST_VIEWED_PAGES = 3;

/** The pinned and certified stories named in the system prompt; none when they cannot be loaded. */
export async function listTrustedStoriesForPrompt(scope: StoryReferenceScope): Promise<StorySummary[]> {
	try {
		const stories = await storyReferenceQueries.listReferenceableStories(scope.userId, scope.projectId, {
			trustedOnly: true,
			limit: MAX_TRUSTED_STORIES_IN_PROMPT,
		});
		return stories.map(toStorySummary);
	} catch (error) {
		logger.error(`Failed to list trusted stories: ${String(error)}`, {
			source: 'agent',
			projectId: scope.projectId,
		});
		return [];
	}
}

/** Popular stories the user cannot see are skipped, so the ranking is read page by page until enough remain. */
export async function listMostViewedStories(
	scope: StoryReferenceScope,
	limit: number,
): Promise<storyReferenceQueries.ReferenceableStory[]> {
	const since = new Date(Date.now() - MOST_VIEWED_PERIOD_MS);
	const pageSize = storyReferenceQueries.MAX_REFERENCEABLE_STORIES_LIMIT;
	const stories: storyReferenceQueries.ReferenceableStory[] = [];
	for (let page = 0; page < MAX_MOST_VIEWED_PAGES && stories.length < limit; page++) {
		const rankedStoryIds = await analyticsEventQueries.listMostViewedStoryIds(scope.projectId, since, {
			limit: pageSize,
			offset: page * pageSize,
		});
		stories.push(...(await keepReferenceableInRankOrder(scope, rankedStoryIds)));
		if (rankedStoryIds.length < pageSize) {
			break;
		}
	}
	return stories.slice(0, limit);
}

/** Null when the story does not exist, is archived, or the user cannot see it. Long content is truncated. */
export async function readReferencedStory(scope: StoryReferenceScope, storyId: string): Promise<StoryDetails | null> {
	const story = await storyReferenceQueries.getReferenceableStory(scope.userId, scope.projectId, storyId);
	if (!story) {
		return null;
	}
	return truncateStoryContent(await loadStoryDetails(story));
}

export async function loadStoryDetails(story: storyReferenceQueries.ReferenceableStory): Promise<StoryDetails> {
	const [details] = await loadStoriesDetails([story]);
	return details;
}

/** Loads the files and queries of every story in two queries, whatever the number of stories. */
export async function loadStoriesDetails(stories: storyReferenceQueries.ReferenceableStory[]): Promise<StoryDetails[]> {
	const filesByVersionId = await loadPublishedFiles(
		stories.filter((story) => story.format === 'custom').map((story) => story.versionId),
	);
	const storiesWithContent = stories.map((story) => {
		const files = filesByVersionId.get(story.versionId) ?? [];
		return { story, files, queryIds: storyQueryIdsOf(story, files) };
	});
	const queriesByChatId = await loadStoryQueries(storiesWithContent);
	return storiesWithContent.map(({ story, files, queryIds }) => ({
		...toStorySummary(story),
		version: story.version,
		code: story.format === 'custom' ? '' : story.code,
		files,
		queries: selectStoryQueries(queryIds, story.chatId ? queriesByChatId.get(story.chatId) : undefined),
	}));
}

export function toStorySummary(story: storyReferenceQueries.ReferenceableStory): StorySummary {
	return {
		id: story.storyId,
		title: story.title,
		author: story.authorName,
		format: story.format,
		pinned: story.isPinned,
		certified: story.isCertified,
		updatedAt: story.updatedAt.toISOString(),
	};
}

/**
 * Replaces every `@[story:<id>]` and `@[story-folder:<id>]` token of the user messages with the story or
 * folder name, and appends the content of each story to the first message that references it, directly
 * or through its folder. The tokens stay in the stored messages, so a referenced story keeps being
 * available on every later turn.
 */
export async function expandStoryReferences<T extends MessageLike>(
	messages: T[],
	scope: StoryReferenceScope,
): Promise<T[]> {
	const folderIds = capReferencedIds(messages.flatMap(referencedFolderIdsOf), MAX_REFERENCED_FOLDERS);
	const folders = await loadFolderReferences(scope, folderIds.kept);
	const storyIds = capReferencedIds(
		messages.flatMap((message) => referencedStoryIdsOf(message, folders)),
		MAX_REFERENCED_STORIES,
	);
	if (storyIds.kept.length === 0 && folderIds.kept.length === 0) {
		return messages;
	}
	const references: References = {
		stories: await loadReferences(scope, storyIds.kept),
		folders,
		skippedStoryIds: storyIds.skipped,
		skippedFolderIds: folderIds.skipped,
	};
	const expansion: ExpansionState = { expandedStoryIds: new Set(), remainingLength: MAX_REFERENCED_CONTENT_LENGTH };
	return messages.map((message) => expandMessage(message, references, expansion));
}

/**
 * Compaction replaces the messages before its summary, and with them the references they made: these are
 * carried over to the first message kept, so a referenced story stays available after a compaction.
 */
export function keepStoryReferencesThroughCompaction<T extends MessageLike>(
	history: MessageLike[],
	compactedHistory: T[],
): T[] {
	const keptTokens = new Set(compactedHistory.flatMap(referenceTokensOf));
	const droppedTokens = [...new Set(history.flatMap(referenceTokensOf))].filter((token) => !keptTokens.has(token));
	const firstUserMessageIndex = compactedHistory.findIndex((message) => message.role === 'user');
	if (droppedTokens.length === 0 || firstUserMessageIndex === -1) {
		return compactedHistory;
	}
	const carriedReferences: UIMessagePart = {
		type: 'text',
		text: `Referenced earlier in the conversation: ${droppedTokens.join(' ')}`,
	};
	return compactedHistory.map((message, index) =>
		index === firstUserMessageIndex ? { ...message, parts: [carriedReferences, ...message.parts] } : message,
	);
}

/** Keeps the history as it is when the references cannot be resolved. */
export async function safeExpandStoryReferences<T extends MessageLike>(
	messages: T[],
	scope: StoryReferenceScope,
): Promise<T[]> {
	try {
		return await expandStoryReferences(messages, scope);
	} catch (error) {
		logger.error(`Failed to expand story references: ${String(error)}`, {
			source: 'agent',
			projectId: scope.projectId,
		});
		return messages;
	}
}

async function loadPublishedFiles(versionIds: string[]): Promise<Map<string, StoryFile[]>> {
	const files = await storyFileQueries.listFilesOfVersions(versionIds);
	const filesByVersionId = new Map<string, StoryFile[]>();
	for (const file of files.filter((storyFile) => isViewableStoryFile(storyFile.path))) {
		const versionFiles = filesByVersionId.get(file.storyVersionId) ?? [];
		versionFiles.push({ path: file.path, content: file.content });
		filesByVersionId.set(file.storyVersionId, versionFiles);
	}
	return filesByVersionId;
}

/** Files past the budget keep their path but lose their content. */
function fitFilesInBudget(files: StoryFile[]): StoryFile[] {
	let remaining = MAX_FILES_LENGTH;
	return files.map((file) => {
		if (remaining <= 0 && file.content.length > 0) {
			return { path: file.path, content: '', omitted: true };
		}
		const content = truncateMiddle(file.content, Math.max(remaining, 0));
		remaining -= content.length;
		return { path: file.path, content };
	});
}

/** A standalone story has no conversation, so its queries cannot be found. */
async function loadStoryQueries(
	storiesWithContent: { story: storyReferenceQueries.ReferenceableStory; queryIds: Set<string> }[],
): Promise<Map<string, Record<string, StoredSqlQuery>>> {
	const queryIdsByChatId = new Map<string, Set<string>>();
	for (const { story, queryIds } of storiesWithContent) {
		if (story.chatId) {
			const chatQueryIds = queryIdsByChatId.get(story.chatId) ?? new Set();
			queryIds.forEach((queryId) => chatQueryIds.add(queryId));
			queryIdsByChatId.set(story.chatId, chatQueryIds);
		}
	}
	return executeSqlQueries.getLatestSqlQueriesByChats(queryIdsByChatId);
}

/** Admin queries only run in admin mode. */
function selectStoryQueries(queryIds: Set<string>, chatQueries: Record<string, StoredSqlQuery> = {}): StoryQuery[] {
	return [...queryIds].flatMap((queryId) => {
		const query = chatQueries[queryId];
		if (!query || query.adminMode) {
			return [];
		}
		return [{ queryId, sql: query.sqlQuery, ...(query.databaseId && { databaseId: query.databaseId }) }];
	});
}

function storyQueryIdsOf(story: storyReferenceQueries.ReferenceableStory, files: StoryFile[]): Set<string> {
	return story.format === 'custom' ? extractCustomStoryQueryIds(files) : extractQueryIds(story.code);
}

async function loadFolderReferences(
	scope: StoryReferenceScope,
	folderIds: string[],
): Promise<Map<string, FolderReference>> {
	const folders = await Promise.all(
		folderIds.map(async (folderId) => [folderId, await resolveFolderReference(scope, folderId)] as const),
	);
	return new Map(folders.filter((entry): entry is readonly [string, FolderReference] => entry[1] !== null));
}

/** Only the most trusted stories of a large folder are referenced. */
async function resolveFolderReference(scope: StoryReferenceScope, folderId: string): Promise<FolderReference | null> {
	const folder = await storyFolderQueries.findReferencedFolder(scope.userId, scope.projectId, folderId);
	if (!folder) {
		return null;
	}
	const stories = await storyReferenceQueries.listReferenceableStories(scope.userId, scope.projectId, {
		...folder.filters,
		limit: MAX_STORIES_PER_FOLDER_REFERENCE + 1,
	});
	return {
		name: folder.name,
		storyIds: stories.slice(0, MAX_STORIES_PER_FOLDER_REFERENCE).map((story) => story.storyId),
		isPartial: stories.length > MAX_STORIES_PER_FOLDER_REFERENCE,
	};
}

async function loadReferences(scope: StoryReferenceScope, storyIds: string[]): Promise<Map<string, StoryDetails>> {
	if (storyIds.length === 0) {
		return new Map();
	}
	const stories = await storyReferenceQueries.listReferenceableStories(scope.userId, scope.projectId, {
		storyIds,
		limit: storyIds.length,
	});
	const references = await loadStoriesDetails(stories);
	return new Map(references.map((reference) => [reference.id, truncateStoryContent(reference)]));
}

function capReferencedIds(ids: string[], max: number): { kept: string[]; skipped: Set<string> } {
	const uniqueIds = [...new Set(ids)];
	return { kept: uniqueIds.slice(0, max), skipped: new Set(uniqueIds.slice(max)) };
}

function truncateStoryContent(details: StoryDetails): StoryDetails {
	return {
		...details,
		code: truncateMiddle(details.code, MAX_CODE_LENGTH),
		files: fitFilesInBudget(details.files),
	};
}

function expandMessage<T extends MessageLike>(message: T, references: References, expansion: ExpansionState): T {
	const storyIds = referencedStoryIdsOf(message, references.folders);
	if (storyIds.length === 0 && referencedFolderIdsOf(message).length === 0) {
		return message;
	}
	const parts = message.parts.map((part) => replaceReferenceTokens(part, references));
	const newReferences = storyIds
		.filter((storyId) => !expansion.expandedStoryIds.has(storyId))
		.map((storyId) => references.stories.get(storyId))
		.filter((reference): reference is StoryDetails => reference !== undefined);
	if (newReferences.length === 0) {
		return { ...message, parts };
	}
	const { stories, omittedStories } = fitReferencesInBudget(newReferences, expansion);
	const referencesPart: UIMessagePart = {
		type: 'text',
		text: renderToMarkdown(ReferencedStoriesPrompt({ stories, omittedStories })),
	};
	return { ...message, parts: [...parts, referencesPart] };
}

/** Stories past the budget are only named, so the agent reads them from the story library when needed. */
function fitReferencesInBudget(references: StoryDetails[], expansion: ExpansionState) {
	const stories: StoryDetails[] = [];
	const omittedStories: StorySummary[] = [];
	for (const reference of references) {
		expansion.expandedStoryIds.add(reference.id);
		const length = contentLengthOf(reference);
		if (length <= expansion.remainingLength) {
			expansion.remainingLength -= length;
			stories.push(reference);
		} else {
			omittedStories.push(reference);
		}
	}
	return { stories, omittedStories };
}

function contentLengthOf(reference: StoryDetails): number {
	const filesLength = reference.files.reduce((total, file) => total + file.content.length, 0);
	const queriesLength = reference.queries.reduce((total, query) => total + query.sql.length, 0);
	return reference.code.length + filesLength + queriesLength;
}

function replaceReferenceTokens(part: UIMessagePart, references: References): UIMessagePart {
	if (part.type !== 'text') {
		return part;
	}
	const text = replaceStoryAndFolderReferences(part.text, {
		story: (storyId) => describeStory(storyId, references),
		folder: (folderId) => describeFolder(folderId, references),
	});
	return { ...part, text };
}

/** Names are JSON-quoted so a name written by a user reads as a single quoted value, not as the user's words. */
function describeStory(storyId: string, references: References): string {
	const reference = references.stories.get(storyId);
	if (reference) {
		return `@${JSON.stringify(reference.title)}`;
	}
	if (references.skippedStoryIds.has(storyId)) {
		return `@(a story left out because too many stories are referenced, read it under ${toStoryLibraryVirtualPath(storyId)}/)`;
	}
	return '@(a story that is no longer available)';
}

function describeFolder(folderId: string, references: References): string {
	const folder = references.folders.get(folderId);
	if (!folder) {
		return references.skippedFolderIds.has(folderId)
			? '@(a story folder left out because too many story folders are referenced)'
			: '@(a story folder that is no longer available)';
	}
	if (folder.storyIds.length === 0) {
		return `@${JSON.stringify(folder.name)} (a story folder with no story you can see)`;
	}
	if (folder.isPartial) {
		return `@${JSON.stringify(folder.name)} (a story folder, its ${folder.storyIds.length} most trusted stories are referenced below, its other stories are left out)`;
	}
	return `@${JSON.stringify(folder.name)} (a story folder, its stories are referenced below)`;
}

function referencedStoryIdsOf(message: MessageLike, folders: Map<string, FolderReference>): string[] {
	const storyIds = textPartsOf(message).flatMap(extractStoryReferenceIds);
	const folderStoryIds = referencedFolderIdsOf(message).flatMap((folderId) => folders.get(folderId)?.storyIds ?? []);
	return [...new Set([...storyIds, ...folderStoryIds])];
}

function referencedFolderIdsOf(message: MessageLike): string[] {
	return [...new Set(textPartsOf(message).flatMap(extractStoryFolderReferenceIds))];
}

function referenceTokensOf(message: MessageLike): string[] {
	const texts = textPartsOf(message);
	return [
		...texts.flatMap(extractStoryReferenceIds).map((storyId) => `@[${toStoryReferenceMentionId(storyId)}]`),
		...texts.flatMap(extractStoryFolderReferenceIds).map((folderId) => `@[${toStoryFolderMentionId(folderId)}]`),
	];
}

function textPartsOf(message: MessageLike): string[] {
	if (message.role !== 'user') {
		return [];
	}
	return message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : []));
}

async function keepReferenceableInRankOrder(
	scope: StoryReferenceScope,
	rankedStoryIds: string[],
): Promise<storyReferenceQueries.ReferenceableStory[]> {
	if (rankedStoryIds.length === 0) {
		return [];
	}
	const stories = await storyReferenceQueries.listReferenceableStories(scope.userId, scope.projectId, {
		storyIds: rankedStoryIds,
		limit: rankedStoryIds.length,
	});
	const rankByStoryId = new Map(rankedStoryIds.map((storyId, rank) => [storyId, rank]));
	return stories.sort((a, b) => (rankByStoryId.get(a.storyId) ?? 0) - (rankByStoryId.get(b.storyId) ?? 0));
}
