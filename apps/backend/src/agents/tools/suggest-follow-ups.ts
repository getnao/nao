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
		value: 'Follow-ups suggested successfully.',
	}),
});
