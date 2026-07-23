import type { executeSql } from '@nao/shared/tools';
import type { UIMessage, UIToolPart } from '@nao/backend/chat';

export function applyExecuteSqlInputToMessages(
	messages: UIMessage[],
	queryId: string,
	input: executeSql.Input,
): UIMessage[] {
	return messages.map((message) => {
		let changed = false;
		const parts = message.parts.map((part) => {
			if (part.type !== 'tool-execute_sql') {
				return part;
			}
			const toolPart = part as UIToolPart<'execute_sql'>;
			if (toolPart.output?.id !== queryId) {
				return part;
			}
			changed = true;
			return { ...toolPart, input } as typeof part;
		});
		return changed ? { ...message, parts } : message;
	});
}

export function applyExecuteSqlResultToMessages(
	messages: UIMessage[],
	queryId: string,
	input: executeSql.Input,
	output: executeSql.Output,
): UIMessage[] {
	return messages.map((message) => {
		let changed = false;
		const parts = message.parts.map((part) => {
			if (part.type !== 'tool-execute_sql') {
				return part;
			}
			const toolPart = part as UIToolPart<'execute_sql'>;
			if (toolPart.output?.id !== queryId) {
				return part;
			}
			changed = true;
			return { ...toolPart, input, output } as typeof part;
		});
		return changed ? { ...message, parts } : message;
	});
}
