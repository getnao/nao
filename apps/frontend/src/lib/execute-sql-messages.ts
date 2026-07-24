import type { executeSql } from '@nao/shared/tools';
import type { UIMessage, UIToolPart } from '@nao/backend/chat';

/** Prefer the latest matching execute_sql in the chat (same rule as stories / SQL edit). */
export function findLatestExecuteSqlInMessages(
	messages: UIMessage[],
	queryId: string,
): { input?: executeSql.Input; output: executeSql.Output } | null {
	let latest: { input?: executeSql.Input; output: executeSql.Output } | null = null;
	for (const message of messages) {
		for (const part of message.parts) {
			if (part.type !== 'tool-execute_sql' || part.output?.id !== queryId) {
				continue;
			}
			const toolPart = part as UIToolPart<'execute_sql'>;
			if (!toolPart.output) {
				continue;
			}
			latest = { input: toolPart.input, output: toolPart.output };
		}
	}
	return latest;
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
			return { ...(part as UIToolPart<'execute_sql'>), input, output } as typeof part;
		});
		return { ...message, parts };
	});
}
