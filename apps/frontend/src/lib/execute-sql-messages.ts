import { executeSemanticQuery } from '@nao/shared/tools';
import { areStructurallyEqual } from './ai';
import type { executeSql } from '@nao/shared/tools';
import type { UIMessage, UIMessagePart, UIToolPart } from '@nao/backend/chat';

export type SourceQuery = {
	input?: executeSql.Input;
	output: executeSql.Output;
	toolCallId?: string;
	/** The metric query the semantic layer compiled `input.sql_query` from. */
	semanticQuery?: executeSemanticQuery.SemanticQuery;
};

export type SemanticSourceQuery = SourceQuery & {
	input: executeSql.Input;
	semanticQuery: executeSemanticQuery.SemanticQuery;
};

export function isSemanticSourceQuery(sourceQuery: SourceQuery): sourceQuery is SemanticSourceQuery {
	return Boolean(sourceQuery.input && sourceQuery.semanticQuery);
}

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
		return toolPart.output
			? { input: toolPart.input, output: toolPart.output, toolCallId: toolPart.toolCallId }
			: null;
	}
	if (part.type === 'tool-execute_semantic_query') {
		const toolPart = part as UIToolPart<'execute_semantic_query'>;
		return toolPart.output
			? { ...semanticQueryAsSql(toolPart.input, toolPart.output), toolCallId: toolPart.toolCallId }
			: null;
	}
	return null;
}

export function semanticQueryAsSql(
	input: { name?: string } | undefined,
	output: executeSemanticQuery.Output,
): SourceQuery {
	const semanticQuery = executeSemanticQuery.SemanticQuerySchema.safeParse(input);
	return {
		input: { sql_query: output.compiled_sql, database_id: output.database_id, name: input?.name },
		output,
		...(semanticQuery.success && { semanticQuery: semanticQuery.data }),
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
		left.toolCallId === right.toolCallId &&
		left.output.revision === right.output.revision &&
		areStructurallyEqual(left.input, right.input) &&
		areStructurallyEqual(left.semanticQuery, right.semanticQuery)
	);
}

export function applyExecuteSqlResultToMessages(
	messages: UIMessage[],
	queryId: string,
	input: executeSql.Input,
	output: executeSql.Output,
): UIMessage[] {
	return applyQueryResultToMessages(messages, 'tool-execute_sql', queryId, input, output);
}

export function applySemanticQueryResultToMessages(
	messages: UIMessage[],
	queryId: string,
	input: executeSemanticQuery.Input,
	output: executeSemanticQuery.Output,
): UIMessage[] {
	return applyQueryResultToMessages(messages, 'tool-execute_semantic_query', queryId, input, output);
}

/** Update only the latest query part of this type for a query id. */
function applyQueryResultToMessages(
	messages: UIMessage[],
	partType: 'tool-execute_sql' | 'tool-execute_semantic_query',
	queryId: string,
	input: executeSql.Input | executeSemanticQuery.Input,
	output: executeSql.Output,
): UIMessage[] {
	let latestMessageIndex = -1;
	let latestPartIndex = -1;

	for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
		const message = messages[messageIndex];
		for (let partIndex = 0; partIndex < message.parts.length; partIndex++) {
			const part = message.parts[partIndex];
			if (part.type !== partType) {
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
