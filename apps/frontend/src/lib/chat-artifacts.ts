import { isQueryResultPart } from '@nao/shared/execute-sql-parts';
import { getMessageDocuments } from './ai';
import { findStories } from './story.utils';
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

export interface ChatArtifacts {
	stories: StorySummary[];
	files: FileArtifact[];
	queries: QueryArtifact[];
}

const artifactsByMessages = new WeakMap<UIMessage[], ChatArtifacts>();

/** Everything a conversation produced or received that outlives a single message. */
export function collectChatArtifacts(messages: UIMessage[]): ChatArtifacts {
	const cached = artifactsByMessages.get(messages);
	if (cached) {
		return cached;
	}
	const artifacts: ChatArtifacts = {
		stories: findStories(messages),
		files: collectFileArtifacts(messages),
		queries: collectQueryArtifacts(messages),
	};
	artifactsByMessages.set(messages, artifacts);
	return artifacts;
}

export function countChatArtifacts(artifacts: ChatArtifacts, includeQueries: boolean): number {
	return artifacts.stories.length + artifacts.files.length + (includeQueries ? artifacts.queries.length : 0);
}

export function areChatArtifactsEqual(left: ChatArtifacts, right: ChatArtifacts): boolean {
	return (
		left === right ||
		(areListsEqual(left.stories, right.stories, (a, b) => a.id === b.id && a.title === b.title) &&
			areListsEqual(left.files, right.files, (a, b) => a.path === b.path && a.filename === b.filename) &&
			areListsEqual(left.queries, right.queries, areQueryArtifactsEqual))
	);
}

function collectFileArtifacts(messages: UIMessage[]): FileArtifact[] {
	const byPath = new Map<string, FileArtifact>();
	for (const message of messages) {
		if (message.role !== 'user') {
			continue;
		}
		for (const document of getMessageDocuments(message)) {
			byPath.set(document.path, document);
		}
	}
	return [...byPath.values()];
}

/** A query id re-run in place keeps its position but takes the shape of its latest run. */
function collectQueryArtifacts(messages: UIMessage[]): QueryArtifact[] {
	const byId = new Map<string, QueryArtifact>();
	for (const message of messages) {
		for (const part of message.parts) {
			const artifact = toQueryArtifact(part);
			if (artifact) {
				byId.set(artifact.id, artifact);
			}
		}
	}
	return [...byId.values()];
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
