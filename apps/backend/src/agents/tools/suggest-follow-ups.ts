import { suggestFollowUps } from '@nao/shared/tools';
import { tool } from 'ai';

export default tool<suggestFollowUps.Input, suggestFollowUps.Output>({
	description:
		'Generate 1–3 contextually useful messages that extend an analytical business-data response. Call this tool for analytical responses even when the visible answer is complete; skip it only for simple one-fact lookups, acknowledgements, and clarification requests. It must be the sole and final tool call, and the turn must include a complete visible answer.',
	inputSchema: suggestFollowUps.InputSchema,
	outputSchema: suggestFollowUps.OutputSchema,

	execute: async () => {
		return {
			_version: '1',
			success: true,
		};
	},

	toModelOutput: () => ({
		type: 'text',
		value: 'Follow-ups recorded, but this response carried no visible answer: notes written before a tool call are hidden from the user. Write your complete answer now as your final message, following every rule of your instructions, and call no other tool. If you already wrote it as visible text earlier in this turn, end the turn without repeating it.',
	}),
});
