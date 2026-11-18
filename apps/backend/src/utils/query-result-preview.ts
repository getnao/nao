import { isQueryResultPartType } from '@nao/shared/execute-sql-parts';
import type { executeSql } from '@nao/shared/tools';
import type { InferUIMessageChunk } from 'ai';

import type { UIChat, UIMessage, UIMessagePart } from '../types/chat';

export const QUERY_RESULT_PREVIEW_ROWS = 100;

type UIMessageChunk = InferUIMessageChunk<UIMessage>;

export type QueryPartColumns = {
	queryId: string | null;
	toolOutputPreview: unknown;
};

/**
 * Query results can hold hundreds of thousands of rows. The web app only receives the first ones
 * and loads the others page by page, while the full result stays persisted for the agent.
 */
export function withQueryResultPreviewsInStream(
	stream: ReadableStream<UIMessageChunk>,
): ReadableStream<UIMessageChunk> {
	const queryToolCallIds = new Set<string>();

	return stream.pipeThrough(
		new TransformStream<UIMessageChunk, UIMessageChunk>({
			transform(chunk, controller) {
				if (isQueryToolInputChunk(chunk)) {
					queryToolCallIds.add(chunk.toolCallId);
				}
				if (chunk.type === 'tool-output-available' && queryToolCallIds.has(chunk.toolCallId)) {
					controller.enqueue({ ...chunk, output: toQueryResultPreview(chunk.output) });
					return;
				}
				controller.enqueue(chunk);
			},
		}),
	);
}

export function withQueryResultPreviewsInChat<T extends Pick<UIChat, 'messages'>>(chat: T): T {
	return {
		...chat,
		messages: chat.messages.map((message) => ({
			...message,
			parts: message.parts.map(toQueryResultPreviewPart),
		})),
	};
}

export function toQueryResultPreview<T>(output: T): T {
	if (!isQueryOutput(output) || output.data.length <= QUERY_RESULT_PREVIEW_ROWS) {
		return output;
	}
	return { ...output, data: output.data.slice(0, QUERY_RESULT_PREVIEW_ROWS), is_preview: true };
}

/**
 * Stored next to a query tool output so the result can be found by its id, and a chat can load
 * with the first rows of a large result instead of all of them.
 */
export function toQueryPartColumns(toolName: string, output: unknown): QueryPartColumns {
	if (!isQueryResultPartType(`tool-${toolName}`)) {
		return { queryId: null, toolOutputPreview: null };
	}
	const preview = toQueryResultPreview(output);
	return {
		queryId: readQueryId(output),
		toolOutputPreview: preview === output ? null : preview,
	};
}

function toQueryResultPreviewPart(part: UIMessagePart): UIMessagePart {
	if (!isQueryResultPartType(part.type) || !('output' in part) || !part.output) {
		return part;
	}
	return { ...part, output: toQueryResultPreview(part.output) } as UIMessagePart;
}

function isQueryToolInputChunk(
	chunk: UIMessageChunk,
): chunk is Extract<UIMessageChunk, { type: 'tool-input-start' | 'tool-input-available' }> {
	return (
		(chunk.type === 'tool-input-start' || chunk.type === 'tool-input-available') &&
		isQueryResultPartType(`tool-${chunk.toolName}`)
	);
}

function isQueryOutput(output: unknown): output is executeSql.Output {
	return typeof output === 'object' && output !== null && Array.isArray((output as executeSql.Output).data);
}

function readQueryId(output: unknown): string | null {
	const id = (output as { id?: unknown } | null | undefined)?.id;
	return typeof id === 'string' ? id : null;
}
