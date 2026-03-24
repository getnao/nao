import { suggestFollowUps } from '@nao/shared/tools';
import { tool } from 'ai';

export default tool<suggestFollowUps.Input, suggestFollowUps.Output>({
	description:
		'Suggest follow-up messages the user might want to send next. This should be the last tool you call and should only be called once per turn. When using this tool always send your reponses before calling this tool as it will stop the agent.',
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
