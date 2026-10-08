import { isQueryResultPart } from '@nao/shared/execute-sql-parts';
import { isToolUIPart } from 'ai';

import * as storyQueries from '../queries/story.queries';
import * as storyFileQueries from '../queries/story-file.queries';
import type { ChatArtifacts, QueryArtifact, StoryArtifact } from '../types/artifacts';
import type { UIMessage, UIMessagePart } from '../types/chat';
import { getStoryTemplateWarnings } from './story-template-validation';

type StoryToolPart = Extract<UIMessagePart, { type: 'tool-story'; state: 'output-available' }>;

/**
 * Rebuilds the conversation's artifacts for a turn: the query results found in the loaded
 * message history and the stories stored for the chat, at their current version.
 */
export async function getChatArtifacts(chatId: string, messages: UIMessage[]): Promise<ChatArtifacts> {
	const [queries, stories] = await Promise.all([
		collectQueryArtifacts(messages),
		loadStoryArtifacts(chatId, messages),
	]);
	return { queries, stories };
}

export function hasChatArtifacts(artifacts: ChatArtifacts): boolean {
	return artifacts.queries.length > 0 || artifacts.stories.length > 0;
}

/** A query id re-run in place keeps its position but takes the columns of its latest run. */
export function collectQueryArtifacts(messages: UIMessage[]): QueryArtifact[] {
	const latestByQueryId = new Map<string, QueryArtifact>();
	for (const part of allParts(messages)) {
		const artifact = toQueryArtifact(part);
		if (artifact) {
			latestByQueryId.set(artifact.id, artifact);
		}
	}
	return [...latestByQueryId.values()];
}

/**
 * Stories come from the database, where user edits and archiving land; only a story a fork
 * pinned into the conversation without storing it is taken from its tool output instead.
 */
async function loadStoryArtifacts(chatId: string, messages: UIMessage[]): Promise<StoryArtifact[]> {
	const storedStories = await storyQueries.listLatestVersionsInChat(chatId);
	const storedSlugs = new Set(storedStories.map((story) => story.slug));
	const liveStories = storedStories.filter((story) => story.archivedAt === null);
	const pinnedStories = collectPinnedStoryArtifacts(messages).filter((story) => !storedSlugs.has(story.id));
	return [...(await toStoredStoryArtifacts(chatId, liveStories)), ...pinnedStories];
}

function toStoredStoryArtifacts(
	chatId: string,
	stories: storyQueries.ChatStoryLatestVersion[],
): Promise<StoryArtifact[]> {
	return Promise.all(
		stories.map(async (story) => ({
			id: story.slug,
			title: story.title,
			version: story.version ?? 0,
			format: story.format,
			code: story.code ?? '',
			files: story.format === 'custom' ? await listDraftFilePaths(story.storyId) : [],
			editedByUser: story.source === 'user',
			templateWarnings:
				story.format === 'classic' && story.code ? await getStoryTemplateWarnings(chatId, story.code) : [],
		})),
	);
}

async function listDraftFilePaths(storyId: string): Promise<string[]> {
	const files = await storyFileQueries.listDraftFiles(storyId);
	return files.map((file) => file.path);
}

function collectPinnedStoryArtifacts(messages: UIMessage[]): StoryArtifact[] {
	const latestBySlug = new Map<string, StoryArtifact>();
	for (const part of allParts(messages)) {
		if (isStoryToolPart(part) && part.output.success && part.output.code) {
			latestBySlug.set(part.output.id, {
				id: part.output.id,
				title: part.output.title,
				version: part.output.version,
				format: part.output.format ?? 'classic',
				code: part.output.code,
				files: [],
				editedByUser: false,
				templateWarnings: [],
			});
		}
	}
	return [...latestBySlug.values()];
}

function toQueryArtifact(part: UIMessagePart): QueryArtifact | undefined {
	if (!isQueryResultPart(part) || part.state !== 'output-available') {
		return undefined;
	}
	const input = part.input as { name?: string } | undefined;
	return {
		id: part.output.id,
		title: input?.name,
		columns: part.output.columns,
		rowCount: part.output.row_count,
	};
}

function isStoryToolPart(part: UIMessagePart): part is StoryToolPart {
	return isToolUIPart(part) && part.type === 'tool-story' && part.state === 'output-available';
}

function* allParts(messages: UIMessage[]): Generator<UIMessagePart> {
	for (const message of messages) {
		yield* message.parts;
	}
}
