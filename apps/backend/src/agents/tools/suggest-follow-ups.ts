import { suggestFollowUps } from '@nao/shared/tools';
import { tool } from 'ai';

export default tool<suggestFollowUps.Input, suggestFollowUps.Output>({
	description:
		'Suggest follow-up messages the user might want to send next. This should be the last tool you call and should only be called once per turn. Always send your response before calling this tool as it will stop the agent, and end that response with a short friendly sentence inviting the user to click one of the suggestions shown below your message.',
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
