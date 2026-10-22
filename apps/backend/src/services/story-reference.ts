import {
	extractStoryFolderReferenceIds,
	extractStoryReferenceIds,
	replaceStoryFolderReferences,
	replaceStoryReferences,
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
import { extractCustomStoryQueryIds } from '../utils/story-query-data';
import { chunk, truncateMiddle } from '../utils/utils';

export type StoryReferenceScope = { userId: string; projectId: string };

type MessageLike = Omit<UIMessage, 'id'>;

type ExpansionState = { expandedStoryIds: Set<string>; remainingLength: number };

type FolderReference = { name: string; storyIds: string[] };

const MAX_CODE_LENGTH = 20_000;
const MAX_FILES_LENGTH = 30_000;
const MAX_REFERENCED_CONTENT_LENGTH = 100_000;
const MAX_TRUSTED_STORIES_IN_PROMPT = 20;
const MAX_STORIES_PER_FOLDER_REFERENCE = 20;
const MOST_VIEWED_PERIOD_MS = 7 * 24 * 60 * 60 * 1_000;

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

/** Popular stories the user cannot see are skipped, so a few more are ranked than returned. */
export async function listMostViewedStories(
	scope: StoryReferenceScope,
	limit: number,
): Promise<storyReferenceQueries.ReferenceableStory[]> {
	const since = new Date(Date.now() - MOST_VIEWED_PERIOD_MS);
	const rankedStoryIds = await analyticsEventQueries.listMostViewedStoryIds(
		scope.projectId,
		since,
		storyReferenceQueries.MAX_REFERENCEABLE_STORIES_LIMIT,
	);
	if (rankedStoryIds.length === 0) {
		return [];
	}
	const stories = await storyReferenceQueries.listReferenceableStories(scope.userId, scope.projectId, {
		storyIds: rankedStoryIds,
		limit: rankedStoryIds.length,
	});
	const rankByStoryId = new Map(rankedStoryIds.map((storyId, rank) => [storyId, rank]));
	return stories
		.sort((a, b) => (rankByStoryId.get(a.storyId) ?? 0) - (rankByStoryId.get(b.storyId) ?? 0))
		.slice(0, limit);
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
	const folderIds = [...new Set(messages.flatMap(referencedFolderIdsOf))];
	const folders = await loadFolderReferences(scope, folderIds);
	const storyIds = [...new Set(messages.flatMap((message) => referencedStoryIdsOf(message, folders)))];
	if (storyIds.length === 0 && folderIds.length === 0) {
		return messages;
	}
	const references = await loadReferences(scope, storyIds);
	const expansion: ExpansionState = { expandedStoryIds: new Set(), remainingLength: MAX_REFERENCED_CONTENT_LENGTH };
	return messages.map((message) => expandMessage(message, references, folders, expansion));
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
		const content = remaining > 0 ? truncateMiddle(file.content, remaining) : '';
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
	if (!folder || folder.storyIds.length === 0) {
		return folder;
	}
	const stories = await storyReferenceQueries.listReferenceableStories(scope.userId, scope.projectId, {
		storyIds: folder.storyIds,
		limit: MAX_STORIES_PER_FOLDER_REFERENCE,
	});
	return { name: folder.name, storyIds: stories.map((story) => story.storyId) };
}

async function loadReferences(scope: StoryReferenceScope, storyIds: string[]): Promise<Map<string, StoryDetails>> {
	const storyBatches = await Promise.all(
		chunk(storyIds, storyReferenceQueries.MAX_REFERENCEABLE_STORIES_LIMIT).map((storyIdsBatch) =>
			storyReferenceQueries.listReferenceableStories(scope.userId, scope.projectId, {
				storyIds: storyIdsBatch,
				limit: storyIdsBatch.length,
			}),
		),
	);
	const references = await loadStoriesDetails(storyBatches.flat());
	return new Map(references.map((reference) => [reference.id, truncateStoryContent(reference)]));
}

function truncateStoryContent(details: StoryDetails): StoryDetails {
	return {
		...details,
		code: truncateMiddle(details.code, MAX_CODE_LENGTH),
		files: fitFilesInBudget(details.files),
	};
}

function expandMessage<T extends MessageLike>(
	message: T,
	references: Map<string, StoryDetails>,
	folders: Map<string, FolderReference>,
	expansion: ExpansionState,
): T {
	const storyIds = referencedStoryIdsOf(message, folders);
	if (storyIds.length === 0 && referencedFolderIdsOf(message).length === 0) {
		return message;
	}
	const parts = message.parts.map((part) => replaceReferenceTokens(part, references, folders));
	const newReferences = storyIds
		.filter((storyId) => !expansion.expandedStoryIds.has(storyId))
		.map((storyId) => references.get(storyId))
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

function replaceReferenceTokens(
	part: UIMessagePart,
	references: Map<string, StoryDetails>,
	folders: Map<string, FolderReference>,
): UIMessagePart {
	if (part.type !== 'text') {
		return part;
	}
	const withStories = replaceStoryReferences(part.text, (storyId) => {
		const reference = references.get(storyId);
		return reference ? `@"${reference.title}"` : '@(a story that is no longer available)';
	});
	const text = replaceStoryFolderReferences(withStories, (folderId) => describeFolder(folders.get(folderId)));
	return { ...part, text };
}

function describeFolder(folder: FolderReference | undefined): string {
	if (!folder) {
		return '@(a story folder that is no longer available)';
	}
	if (folder.storyIds.length === 0) {
		return `@"${folder.name}" (a story folder with no story you can see)`;
	}
	return `@"${folder.name}" (a story folder, its stories are referenced below)`;
}

function referencedStoryIdsOf(message: MessageLike, folders: Map<string, FolderReference>): string[] {
	const storyIds = textPartsOf(message).flatMap(extractStoryReferenceIds);
	const folderStoryIds = referencedFolderIdsOf(message).flatMap((folderId) => folders.get(folderId)?.storyIds ?? []);
	return [...new Set([...storyIds, ...folderStoryIds])];
}

function referencedFolderIdsOf(message: MessageLike): string[] {
	return [...new Set(textPartsOf(message).flatMap(extractStoryFolderReferenceIds))];
}

function textPartsOf(message: MessageLike): string[] {
	if (message.role !== 'user') {
		return [];
	}
	return message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : []));
}
