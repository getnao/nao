import { generateOnboardingRules } from '@nao/shared/tools';

import { submitWarehouseBusinessContext } from '../../services/warehouse-provisioning';
import { createTool } from '../../utils/tools';

export default createTool<generateOnboardingRules.Input, generateOnboardingRules.Output>({
	description:
		'Save the business context collected during onboarding. Once warehouse metadata is synced, the setup generates the initial RULES.md from it and finishes the project.',
	inputSchema: generateOnboardingRules.InputSchema,
	outputSchema: generateOnboardingRules.OutputSchema,
	execute: async ({ businessContext }, context) => {
		const { jobId, status } = await submitWarehouseBusinessContext(context.userId, context.chatId, {
			businessContext,
			modelSelection: context.modelSelection,
			modelProjectId: context.projectId,
		});

		return {
			_version: '1',
			jobId,
			status,
		};
	},
	toModelOutput: ({ output }) => ({
		type: 'text',
		value: `Business context saved. The setup status is ${output.status}. Call wait_for_warehouse_setup to follow the end of the setup.`,
	}),
});
