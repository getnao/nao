import { suggestFollowUps } from '@nao/shared/tools';
import { type ModelMessage, tool } from 'ai';

import { truncateMiddle } from '../../utils/utils';

const MAX_QUOTED_TEXT_LENGTH = 1000;

const NO_VISIBLE_TEXT_RESULT =
	'Follow-ups recorded. The user has not seen any answer in this turn: nothing you wrote so far is visible to them, including any note written before a tool call. Write your complete answer now as your final message, following every rule of your instructions, and call no other tool.';

export default tool<suggestFollowUps.Input, suggestFollowUps.Output>({
	description:
		'Generate 1–3 contextually useful messages that extend an analytical business-data response. Call this tool for analytical responses even when the visible answer is complete; skip it only for simple one-fact lookups, acknowledgements, and clarification requests. It must be the sole and final tool call, and the turn must include a complete visible answer.',
	inputSchema: suggestFollowUps.InputSchema,
	outputSchema: suggestFollowUps.OutputSchema,

	execute: async (_input, { messages }) => {
		const visibleText = getVisibleTextOfCurrentTurn(messages);
		return {
			_version: '1',
			success: true,
			...(visibleText && { visibleTextInTurn: truncateMiddle(visibleText, MAX_QUOTED_TEXT_LENGTH) }),
		};
	},

	toModelOutput: ({ output }) => ({
		type: 'text',
		value: output.visibleTextInTurn ? quoteVisibleText(output.visibleTextInTurn) : NO_VISIBLE_TEXT_RESULT,
	}),
});

/** The messages a tool receives stop before the response that calls it, so this is the text of the turn's earlier steps. */
function getVisibleTextOfCurrentTurn(messages: ModelMessage[]): string {
	const lastUserMessageIndex = messages.map((message) => message.role).lastIndexOf('user');
	return messages
		.slice(lastUserMessageIndex + 1)
		.flatMap(getAssistantTexts)
		.map((text) => text.trim())
		.filter((text) => text.length > 0)
		.join('\n\n');
}

function getAssistantTexts(message: ModelMessage): string[] {
	if (message.role !== 'assistant') {
		return [];
	}
	if (typeof message.content === 'string') {
		return [message.content];
	}
	return message.content.flatMap((part) => (part.type === 'text' ? [part.text] : []));
}

function quoteVisibleText(visibleText: string): string {
	return `Follow-ups recorded, but this response carried no visible answer: notes written before a tool call are hidden from the user. The only text the user has seen in this turn is:\n\n<visible_text>\n${visibleText}\n</visible_text>\n\nIf it is not your complete answer, write your complete answer now as your final message, following every rule of your instructions, and call no other tool. If it is, end the turn without repeating it.`;
}
