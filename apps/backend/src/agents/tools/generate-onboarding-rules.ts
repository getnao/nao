import { generateOnboardingRules } from '@nao/shared/tools';

import { queueWarehouseFinalization } from '../../services/warehouse-provisioning';
import { createTool } from '../../utils/tools';

export default createTool<generateOnboardingRules.Input, generateOnboardingRules.Output>({
	description:
		'Generate the initial RULES.md from synced warehouse metadata and the business context collected during onboarding, then finish project setup.',
	inputSchema: generateOnboardingRules.InputSchema,
	outputSchema: generateOnboardingRules.OutputSchema,
	execute: async ({ jobId, businessContext }, context) => {
		await queueWarehouseFinalization(jobId, context.userId, {
			businessContext,
			modelSelection: context.modelSelection,
			modelProjectId: context.projectId,
		});

		return {
			_version: '1',
			jobId,
			status: 'finalizing',
		};
	},
	toModelOutput: () => ({
		type: 'text',
		value: 'Project finalization started in the background. Tell the user it is continuing, then end this turn.',
	}),
});
