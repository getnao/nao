import type { UIMessage, UIToolPart } from '@nao/backend/chat';

const MAX_DEFAULT_NAME_LENGTH = 80;

export interface TestDraft {
	name: string;
	prompt: string;
	sql: string;
	databaseId: string | null;
}

/** Turns an answer into a test: the question that led to it, checked against the last SQL it ran. */
export function getTestDraft(messages: UIMessage[], answer: UIMessage): TestDraft | null {
	const sqlQuery = findLastExecutedSql(answer);
	const prompt = findQuestionBefore(messages, answer);
	if (!sqlQuery || !prompt) {
		return null;
	}
	return {
		name: toDefaultName(prompt),
		prompt,
		sql: sqlQuery.sql,
		databaseId: sqlQuery.databaseId,
	};
}

function findLastExecutedSql(message: UIMessage): { sql: string; databaseId: string | null } | null {
	for (const part of [...message.parts].reverse()) {
		if (part.type !== 'tool-execute_sql') {
			continue;
		}
		const toolPart = part as UIToolPart<'execute_sql'>;
		if (toolPart.state === 'output-available' && toolPart.input?.sql_query) {
			return { sql: toolPart.input.sql_query, databaseId: toolPart.input.database_id ?? null };
		}
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
