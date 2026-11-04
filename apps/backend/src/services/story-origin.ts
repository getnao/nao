import * as chatQueries from '../queries/chat.queries';
import * as storyReferenceQueries from '../queries/story-reference.queries';
import type { ForkMetadata, StoryOriginTurn, UIMessage } from '../types/chat';
import { compactionService } from './compaction';

const STORY_ORIGIN_FORK_TYPES: ForkMetadata['type'][] = ['story', 'story_question'];
const MAX_ORIGIN_CONVERSATION_LENGTH = 24_000;

export async function resolveStoryOriginConversation(chat: {
	userId: string;
	projectId: string;
	forkMetadata?: ForkMetadata | null;
}): Promise<StoryOriginTurn[]> {
	if (!chat.forkMetadata || !STORY_ORIGIN_FORK_TYPES.includes(chat.forkMetadata.type)) {
		return [];
	}
	const story = await storyReferenceQueries.getReferenceableStory(chat.userId, chat.projectId, chat.forkMetadata.id);
	if (!story?.chatId) {
		return [];
	}
	const messages = compactionService.useLastCompaction(await chatQueries.getChatMessages(story.chatId));
	return keepLatestTurns(messages.flatMap(toTurn));
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
	let length = 0;
	for (const turn of [...turns].reverse()) {
		length += turn.text.length;
		if (length > MAX_ORIGIN_CONVERSATION_LENGTH && keptTurns.length > 0) {
			break;
		}
		keptTurns.unshift(turn);
	}
	return keptTurns;
}
