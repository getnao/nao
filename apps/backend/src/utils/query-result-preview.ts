import type { executeSql } from '@nao/shared/tools';
import type { InferUIMessageChunk } from 'ai';

import { QUERY_TOOL_NAMES } from '../queries/execute-sql.queries';
import type { UIChat, UIMessage, UIMessagePart } from '../types/chat';

export const QUERY_RESULT_PREVIEW_ROWS = 100;

type UIMessageChunk = InferUIMessageChunk<UIMessage>;

const QUERY_TOOL_NAME_SET = new Set<string>(QUERY_TOOL_NAMES);
const QUERY_TOOL_PART_TYPES = new Set<string>(QUERY_TOOL_NAMES.map((toolName) => `tool-${toolName}`));

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

function toQueryResultPreviewPart(part: UIMessagePart): UIMessagePart {
	if (!QUERY_TOOL_PART_TYPES.has(part.type) || !('output' in part) || !part.output) {
		return part;
	}
	return { ...part, output: toQueryResultPreview(part.output) } as UIMessagePart;
}

function isQueryToolInputChunk(
	chunk: UIMessageChunk,
): chunk is Extract<UIMessageChunk, { type: 'tool-input-start' | 'tool-input-available' }> {
	return (
		(chunk.type === 'tool-input-start' || chunk.type === 'tool-input-available') &&
		QUERY_TOOL_NAME_SET.has(chunk.toolName)
	);
}

function isQueryOutput(output: unknown): output is executeSql.Output {
	return typeof output === 'object' && output !== null && Array.isArray((output as executeSql.Output).data);
}
