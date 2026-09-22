import { areStructurallyEqual } from './ai';
import type { executeSemanticQuery, executeSql } from '@nao/shared/tools';
import type { UIMessage, UIMessagePart, UIToolPart } from '@nao/backend/chat';

export type SourceQuery = { input?: executeSql.Input; output: executeSql.Output };
const sourceQueryIndex = new WeakMap<UIMessage[], Map<string, SourceQuery>>();

/**
 * Prefer the latest matching query part in the chat (same rule as stories / SQL edit).
 * A semantic query is read as the SQL the layer compiled, so charts and maps see plain SQL.
 */
export function findLatestExecuteSqlInMessages(messages: UIMessage[], queryId: string): SourceQuery | null {
	let indexed = sourceQueryIndex.get(messages);
	if (indexed) {
		return indexed.get(queryId) ?? null;
	}

	indexed = new Map();
	for (const message of messages) {
		for (const part of message.parts) {
			const sourceQuery = toSourceQuery(part);
			if (sourceQuery) {
				indexed.set(sourceQuery.output.id, sourceQuery);
			}
		}
	}
	sourceQueryIndex.set(messages, indexed);
	return indexed.get(queryId) ?? null;
}

function toSourceQuery(part: UIMessagePart): SourceQuery | null {
	if (part.type === 'tool-execute_sql') {
		const toolPart = part as UIToolPart<'execute_sql'>;
		return toolPart.output ? { input: toolPart.input, output: toolPart.output } : null;
	}
	if (part.type === 'tool-execute_semantic_query') {
		const toolPart = part as UIToolPart<'execute_semantic_query'>;
		return toolPart.output ? semanticQueryAsSql(toolPart.input, toolPart.output) : null;
	}
	return null;
}

export function semanticQueryAsSql(
	input: Pick<executeSemanticQuery.Input, 'name'> | undefined,
	output: executeSemanticQuery.Output,
): SourceQuery {
	return {
		input: { sql_query: output.compiled_sql, database_id: output.database_id, name: input?.name },
		output,
	};
}

export function areSourceQueriesEqual(left: SourceQuery | null, right: SourceQuery | null): boolean {
	if (left === right) {
		return true;
	}
	if (!left || !right) {
		return false;
	}
	return (
		left.output.id === right.output.id &&
		left.output.revision === right.output.revision &&
		areStructurallyEqual(left.input, right.input)
	);
}

/** Update only the latest matching execute_sql part for a query id. */
export function applyExecuteSqlResultToMessages(
	messages: UIMessage[],
	queryId: string,
	input: executeSql.Input,
	output: executeSql.Output,
): UIMessage[] {
	let latestMessageIndex = -1;
	let latestPartIndex = -1;

	for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
		const message = messages[messageIndex];
		for (let partIndex = 0; partIndex < message.parts.length; partIndex++) {
			const part = message.parts[partIndex];
			if (part.type !== 'tool-execute_sql') {
				continue;
			}
			const toolPart = part as UIToolPart<'execute_sql'>;
			if (toolPart.output?.id === queryId) {
				latestMessageIndex = messageIndex;
				latestPartIndex = partIndex;
			}
		}
	}

	if (latestMessageIndex < 0 || latestPartIndex < 0) {
		return messages;
	}

	return messages.map((message, messageIndex) => {
		if (messageIndex !== latestMessageIndex) {
			return message;
		}
		const parts = message.parts.map((part, partIndex) => {
			if (partIndex !== latestPartIndex) {
				return part;
			}
			const toolPart = part as UIToolPart<'execute_sql'>;
			const previousRevision = toolPart.output?.revision ?? 0;
			return { ...toolPart, input, output: { ...output, revision: previousRevision + 1 } } as typeof part;
		});
		return { ...message, parts };
	});
}
