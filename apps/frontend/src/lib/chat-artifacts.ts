import { extractStoryReferenceIds, extractStoryReferenceTags } from '@nao/shared';
import { isQueryResultPart } from '@nao/shared/execute-sql-parts';
import { getMessageDocuments } from './ai';
import { areStoriesEqual, findStories } from './story.utils';
import type { UIMessage, UIMessagePart } from '@nao/backend/chat';
import type { StorySummary } from './story.utils';

export interface FileArtifact {
	path: string;
	filename: string;
	mediaType: string;
}

export interface QueryArtifact {
	id: string;
	title?: string;
	columns: string[];
	rowCount: number;
	toolCallId: string;
}

/** An existing story of another conversation, handed over by the agent or mentioned by the user. */
export interface MentionedStoryArtifact {
	storyId: string;
	title?: string;
}

export interface ChatArtifacts {
	stories: StorySummary[];
	mentionedStories: MentionedStoryArtifact[];
	files: FileArtifact[];
	queries: QueryArtifact[];
}

type MessageArtifacts = Omit<ChatArtifacts, 'stories'>;

const artifactsByMessages = new WeakMap<UIMessage[], ChatArtifacts>();
const artifactsByMessage = new WeakMap<UIMessage, MessageArtifacts>();

/**
 * Everything a conversation produced or received that outlives a single message.
 * Messages carried over from a forked chat are hidden from the thread, so they are left out too.
 */
export function collectChatArtifacts(messages: UIMessage[]): ChatArtifacts {
	const cached = artifactsByMessages.get(messages);
	if (cached) {
		return cached;
	}
	const visibleMessages = messages.filter((message) => !message.isForked);
	const messageArtifacts = visibleMessages.map(getMessageArtifacts);
	const artifacts: ChatArtifacts = {
		stories: findStories(visibleMessages),
		mentionedStories: mergeMentionedStories(messageArtifacts.flatMap((message) => message.mentionedStories)),
		files: mergeLatestBy(
			messageArtifacts.flatMap((message) => message.files),
			(file) => file.path,
		),
		queries: mergeLatestBy(
			messageArtifacts.flatMap((message) => message.queries),
			(query) => query.id,
		),
	};
	artifactsByMessages.set(messages, artifacts);
	return artifacts;
}

/** The tool call of the latest run of a query, which is the one the conversation shows for it. */
export function findQueryToolCallId(messages: UIMessage[], queryId: string): string | undefined {
	return collectChatArtifacts(messages).queries.find((query) => query.id === queryId)?.toolCallId;
}

export function countChatArtifacts(artifacts: ChatArtifacts, includeQueries: boolean): number {
	return artifacts.stories.length + artifacts.files.length + (includeQueries ? artifacts.queries.length : 0);
}

export function areChatArtifactsEqual(left: ChatArtifacts, right: ChatArtifacts): boolean {
	return (
		left === right ||
		(areStoriesEqual(left.stories, right.stories) &&
			areMentionedStoriesEqual(left.mentionedStories, right.mentionedStories) &&
			areListsEqual(left.files, right.files, (a, b) => a.path === b.path && a.filename === b.filename) &&
			areListsEqual(left.queries, right.queries, areQueryArtifactsEqual))
	);
}

export function areMentionedStoriesEqual(left: MentionedStoryArtifact[], right: MentionedStoryArtifact[]): boolean {
	return areListsEqual(left, right, (a, b) => a.storyId === b.storyId && a.title === b.title);
}

/** Only the streaming message is new on each chunk, so the others are read once. */
function getMessageArtifacts(message: UIMessage): MessageArtifacts {
	const cached = artifactsByMessage.get(message);
	if (cached) {
		return cached;
	}
	const artifacts: MessageArtifacts = {
		mentionedStories: listMentionedStories(message),
		files: message.role === 'user' ? getMessageDocuments(message) : [],
		queries: message.parts.map(toQueryArtifact).filter((query) => query !== undefined),
	};
	artifactsByMessage.set(message, artifacts);
	return artifacts;
}

function listMentionedStories(message: UIMessage): MentionedStoryArtifact[] {
	return message.parts.flatMap((part): MentionedStoryArtifact[] => {
		if (part.type !== 'text') {
			return [];
		}
		return message.role === 'user'
			? extractStoryReferenceIds(part.text).map((storyId) => ({ storyId, title: undefined }))
			: extractStoryReferenceTags(part.text);
	});
}

/** In order of first reference; the agent's title wins over a mention, which has none. */
function mergeMentionedStories(references: MentionedStoryArtifact[]): MentionedStoryArtifact[] {
	const byStoryId = new Map<string, MentionedStoryArtifact>();
	for (const reference of references) {
		byStoryId.set(reference.storyId, {
			...reference,
			title: reference.title ?? byStoryId.get(reference.storyId)?.title,
		});
	}
	return [...byStoryId.values()];
}

/** An artifact seen again, such as a query re-run in place, keeps its position but takes the shape of its latest occurrence. */
function mergeLatestBy<T>(items: T[], getKey: (item: T) => string): T[] {
	const byKey = new Map<string, T>();
	for (const item of items) {
		byKey.set(getKey(item), item);
	}
	return [...byKey.values()];
}

function toQueryArtifact(part: UIMessagePart): QueryArtifact | undefined {
	if (!isQueryResultPart(part) || part.state !== 'output-available' || !part.output) {
		return undefined;
	}
	const input = part.input as { name?: string } | undefined;
	return {
		id: part.output.id,
		title: input?.name,
		columns: part.output.columns,
		rowCount: part.output.row_count,
		toolCallId: part.toolCallId,
	};
}

function areQueryArtifactsEqual(left: QueryArtifact, right: QueryArtifact): boolean {
	return (
		left.id === right.id &&
		left.title === right.title &&
		left.rowCount === right.rowCount &&
		left.toolCallId === right.toolCallId &&
		areListsEqual(left.columns, right.columns, (a, b) => a === b)
	);
}

function areListsEqual<T>(left: T[], right: T[], isEqual: (a: T, b: T) => boolean): boolean {
	return left.length === right.length && left.every((item, index) => isEqual(item, right[index]));
}
