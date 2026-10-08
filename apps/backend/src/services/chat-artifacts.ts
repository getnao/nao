import { isQueryResultPart } from '@nao/shared/execute-sql-parts';
import { isToolUIPart } from 'ai';

import { ChatArtifactsPrompt } from '../components/ai/chat-artifacts-prompt';
import { renderToMarkdown } from '../lib/markdown';
import * as storyQueries from '../queries/story.queries';
import * as storyFileQueries from '../queries/story-file.queries';
import type { ChatArtifacts, QueryArtifact, StoryArtifact } from '../types/artifacts';
import type { UIMessage, UIMessagePart } from '../types/chat';
import { logger } from '../utils/logger';
import { getStoryTemplateWarnings } from './story-template-validation';

type StoryToolPart = Extract<UIMessagePart, { type: 'tool-story'; state: 'output-available' }>;
type MessageLike = Omit<UIMessage, 'id'>;

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

/** Undefined when the artifacts cannot be built, so callers keep the history as it is. */
export async function safeGetChatArtifacts(
	chatId: string,
	messages: UIMessage[],
	projectId?: string,
): Promise<ChatArtifacts | undefined> {
	try {
		return await getChatArtifacts(chatId, messages);
	} catch (error) {
		logger.error(`Failed to build chat artifacts: ${String(error)}`, {
			source: 'agent',
			projectId,
			context: { chatId },
		});
		return undefined;
	}
}

export function hasChatArtifacts(artifacts: ChatArtifacts): boolean {
	return artifacts.queries.length > 0 || artifacts.stories.length > 0;
}

/**
 * Story tool outputs in the history shrink to a one-line placeholder: the artifacts carry the
 * current content of every live story, so repeating each version is waste. A story missing from
 * the artifacts has been archived, and its placeholder says so.
 */
export function collapseStoryToolOutputs<T extends MessageLike>(messages: T[], artifacts: ChatArtifacts): T[] {
	const liveStoryIds = new Set(artifacts.stories.map((story) => story.id));
	return messages.map((message) => ({
		...message,
		parts: message.parts.map((part): UIMessagePart => {
			if (!isStoryToolPart(part)) {
				return part;
			}
			const isArchived = !liveStoryIds.has(part.output.id);
			return { ...part, output: { ...part.output, _stale: true, _archived: isArchived, code: '' } };
		}),
	}));
}

/** The artifacts travel in the current user message so that only one copy is ever in context. */
export function appendChatArtifacts<T extends MessageLike>(messages: T[], artifacts: ChatArtifacts): T[] {
	if (!hasChatArtifacts(artifacts)) {
		return messages;
	}
	const artifactsPart: UIMessagePart = { type: 'text', text: renderToMarkdown(ChatArtifactsPrompt({ artifacts })) };
	return appendToLastUserMessage(messages, artifactsPart);
}

function appendToLastUserMessage<T extends MessageLike>(messages: T[], part: UIMessagePart): T[] {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role === 'user') {
			const updatedMessages = [...messages];
			updatedMessages[index] = { ...message, parts: [...message.parts, part] };
			return updatedMessages;
		}
	}
	return messages;
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
