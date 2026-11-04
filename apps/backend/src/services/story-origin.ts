import * as chatQueries from '../queries/chat.queries';
import * as storyReferenceQueries from '../queries/story-reference.queries';
import type { ForkMetadata, StoryOriginTurn, UIMessage } from '../types/chat';
import { logger } from '../utils/logger';
import { compactionService } from './compaction';

const STORY_ORIGIN_FORK_TYPES: ForkMetadata['type'][] = ['story', 'story_question'];
const MAX_ORIGIN_CONVERSATION_LENGTH = 24_000;
const MAX_FORK_CHAIN_DEPTH = 3;

interface StoryForkChat {
	userId: string;
	projectId: string;
	forkMetadata?: ForkMetadata | null;
}

/** The origin conversation only enriches the prompt, so failing to load it must not stop the agent. */
export async function resolveStoryOriginConversationSafely(chat: StoryForkChat): Promise<StoryOriginTurn[]> {
	try {
		return await resolveStoryOriginConversation(chat);
	} catch (error) {
		logger.warn(`Failed to resolve the story origin conversation: ${String(error)}`, { source: 'agent' });
		return [];
	}
}

export async function resolveStoryOriginConversation(chat: StoryForkChat): Promise<StoryOriginTurn[]> {
	const turns = await collectOriginTurns(chat, chat.forkMetadata, MAX_FORK_CHAIN_DEPTH);
	return keepLatestTurns(turns);
}

/** A copied story's chat holds no conversation of its own, so the chain of forked stories is followed back. */
async function collectOriginTurns(
	viewer: StoryForkChat,
	forkMetadata: ForkMetadata | null | undefined,
	remainingDepth: number,
): Promise<StoryOriginTurn[]> {
	if (remainingDepth === 0 || !forkMetadata || !STORY_ORIGIN_FORK_TYPES.includes(forkMetadata.type)) {
		return [];
	}
	const originChatId = await findReadableOriginChatId(viewer, forkMetadata.id);
	if (!originChatId) {
		return [];
	}
	const [messages, originForkMetadata] = await Promise.all([
		chatQueries.getChatMessages(originChatId),
		chatQueries.getForkMetadata(originChatId),
	]);
	const parentTurns = await collectOriginTurns(viewer, originForkMetadata, remainingDepth - 1);
	return [...parentTurns, ...compactionService.useLastCompaction(messages).flatMap(toTurn)];
}

/** Access to a story does not grant access to its conversation, which may hold unrelated private discussion. */
async function findReadableOriginChatId(viewer: StoryForkChat, storyId: string): Promise<string | null> {
	const story = await storyReferenceQueries.getReferenceableStory(viewer.userId, viewer.projectId, storyId);
	if (!story?.chatId) {
		return null;
	}
	return (await chatQueries.canUserAccessChat(story.chatId, viewer.userId)) ? story.chatId : null;
}

function toTurn(message: Omit<UIMessage, 'id'>): StoryOriginTurn[] {
	if (message.role !== 'user' && message.role !== 'assistant') {
		return [];
	}
	const text = message.parts
		.flatMap((part) => (part.type === 'text' ? [part.text.trim()] : []))
		.filter(Boolean)
		.join('\n\n');
	return text ? [{ role: message.role, text }] : [];
}

function keepLatestTurns(turns: StoryOriginTurn[]): StoryOriginTurn[] {
	const keptTurns: StoryOriginTurn[] = [];
	let remainingLength = MAX_ORIGIN_CONVERSATION_LENGTH;
	for (const turn of [...turns].reverse()) {
		if (turn.text.length > remainingLength) {
			if (keptTurns.length === 0) {
				keptTurns.unshift(truncateTurn(turn, remainingLength));
			}
			break;
		}
		remainingLength -= turn.text.length;
		keptTurns.unshift(turn);
	}
	return keptTurns;
}

/** The end of a turn holds its conclusion, so an oversized turn keeps its last characters. */
function truncateTurn(turn: StoryOriginTurn, maxLength: number): StoryOriginTurn {
	return { ...turn, text: `…${turn.text.slice(-(maxLength - 1))}` };
}
