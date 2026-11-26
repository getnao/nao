import type { ModelMessage, ToolResultPart } from 'ai';

import type { QueryResult } from '../types/tools';
import { truncateMiddle } from '../utils/utils';

const TOOL_RESULT_MAX_CHARS = 2000;
const EMPTY_RESPONSE_PLACEHOLDER = '[No visible response]';

/** Replays the response as text: verbatim thinking blocks are rejected once tools differ from the agent's call. */
export function buildVerificationMessages(
	prompt: string,
	responseMessages: ModelMessage[],
	expectedColumns: string[],
	queryResults: Map<string, QueryResult>,
): ModelMessage[] {
	return [
		{ role: 'user', content: prompt },
		{ role: 'assistant', content: renderTranscript(responseMessages) },
		{ role: 'user', content: buildVerificationPrompt(expectedColumns, queryResults) },
	];
}

function renderTranscript(messages: ModelMessage[]): string {
	return messages.flatMap(renderMessage).join('\n\n') || EMPTY_RESPONSE_PLACEHOLDER;
}

function renderMessage(message: ModelMessage): string[] {
	if (message.role !== 'assistant' && message.role !== 'tool') {
		return [];
	}
	if (typeof message.content === 'string') {
		return message.content ? [message.content] : [];
	}
	return message.content.flatMap((part): string[] => {
		switch (part.type) {
			case 'text':
				return part.text ? [part.text] : [];
			case 'tool-call':
				return [`Tool call ${part.toolName}: ${JSON.stringify(part.input)}`];
			case 'tool-result':
				return [
					`Tool result ${part.toolName}:\n${truncateMiddle(renderToolOutput(part), TOOL_RESULT_MAX_CHARS)}`,
				];
			default:
				return [];
		}
	});
}

function renderToolOutput(part: ToolResultPart): string {
	const { output } = part;
	if (output.type === 'text' || output.type === 'error-text') {
		return output.value;
	}
	if ('value' in output) {
		return JSON.stringify(output.value) ?? '';
	}
	return output.type;
}

function buildVerificationPrompt(columns: string[], queryResults: Map<string, QueryResult>): string {
	const tables = [...queryResults.entries()]
		.map(([queryId, result]) => `- ${queryId} (${result.data.length} rows): ${result.columns.join(', ')}`)
		.join('\n');

	return `Based on your previous analysis, write a DuckDB query returning the final answer to the original question.

For context, the messages above include the original user prompt followed by your analysis and answer.

Every query you ran is loaded in DuckDB as a table named after its query id:
${tables}

Rules:
- Only read from the tables above, the warehouse is not reachable anymore.
- Return exactly these columns, with these names: ${columns.join(', ')}
- Read the values from the tables, never retype them as literals.
- Apply the same filters, aggregations and ordering as the answer you gave.
- Set sql to null if these tables cannot answer the question.`;
}
