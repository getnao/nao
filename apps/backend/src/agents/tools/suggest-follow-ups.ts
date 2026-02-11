import { suggestFollowUps } from '@nao/shared/tools';
import { tool } from 'ai';

export default tool<suggestFollowUps.Input, suggestFollowUps.Output>({
	description:
		'Suggest follow-up messages the user might want to send next. This should be the last tool you call and should only be called once per turn. Most of your responses should end with follow-ups suggested via this tool.',
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
