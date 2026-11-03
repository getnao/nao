import { LOCAL_DATABASE_ID } from '@nao/shared/tools';
import type { UIMessage, UIToolPart } from '@nao/backend/chat';

const MAX_DEFAULT_NAME_LENGTH = 80;

export interface TestDraft {
	name: string;
	prompt: string;
	sql: string;
	databaseId: string | null;
}

interface WarehouseQuery {
	sql: string;
	databaseId: string | null;
}

/**
 * Turns an answer into a test: the question that led to it, checked against the last warehouse SQL it ran, or the SQL
 * the semantic layer compiled for it. Queries on nao's local database are skipped, since they read results that only
 * exist in this chat. The question is left empty when the chat has none before the answer.
 */
export function getTestDraft(messages: UIMessage[], answer: UIMessage): TestDraft | null {
	const warehouseQuery = findLastWarehouseQuery(answer);
	if (!warehouseQuery) {
		return null;
	}
	const prompt = findQuestionBefore(messages, answer) ?? '';
	return {
		name: toDefaultName(prompt),
		prompt,
		sql: warehouseQuery.sql,
		databaseId: warehouseQuery.databaseId,
	};
}

/** Whether the answer ran a query a test can be checked against, which only needs the answer itself. */
export function canSaveAsTest(answer: UIMessage): boolean {
	return findLastWarehouseQuery(answer) !== null;
}

function findLastWarehouseQuery(message: UIMessage): WarehouseQuery | null {
	for (const part of [...message.parts].reverse()) {
		const query = toWarehouseQuery(part);
		if (query) {
			return query;
		}
	}
	return null;
}

function toWarehouseQuery(part: UIMessage['parts'][number]): WarehouseQuery | null {
	if (part.type === 'tool-execute_sql') {
		const toolPart = part as UIToolPart<'execute_sql'>;
		const isWarehouseQuery =
			toolPart.state === 'output-available' &&
			toolPart.input?.sql_query &&
			toolPart.input.database_id !== LOCAL_DATABASE_ID;
		return isWarehouseQuery
			? { sql: toolPart.input.sql_query, databaseId: toolPart.input.database_id ?? null }
			: null;
	}
	if (part.type === 'tool-execute_semantic_query') {
		const toolPart = part as UIToolPart<'execute_semantic_query'>;
		return toolPart.state === 'output-available' && toolPart.output?.compiled_sql
			? { sql: toolPart.output.compiled_sql, databaseId: toolPart.output.database_id ?? null }
			: null;
	}
	return null;
}

function findQuestionBefore(messages: UIMessage[], answer: UIMessage): string | null {
	const answerIndex = messages.findIndex((message) => message.id === answer.id);
	const previousMessages = answerIndex === -1 ? messages : messages.slice(0, answerIndex);
	const question = [...previousMessages].reverse().find((message) => message.role === 'user');
	const text = question?.parts
		.flatMap((part) => (part.type === 'text' ? [part.text] : []))
		.join('\n')
		.trim();
	return text || null;
}

function toDefaultName(prompt: string): string {
	const firstLine = prompt.split('\n')[0].trim();
	return firstLine.length > MAX_DEFAULT_NAME_LENGTH
		? `${firstLine.slice(0, MAX_DEFAULT_NAME_LENGTH - 1).trimEnd()}…`
		: firstLine;
}
