import { retryWarehouseSetup } from '@nao/shared/tools';

import { retryWarehouseProvisioning } from '../../services/warehouse-provisioning';
import { createTool } from '../../utils/tools';

export default createTool<retryWarehouseSetup.Input, retryWarehouseSetup.Output>({
	description:
		'Restart the stopped warehouse setup of this conversation with its stored connection details and business context.',
	inputSchema: retryWarehouseSetup.InputSchema,
	outputSchema: retryWarehouseSetup.OutputSchema,
	execute: async (_input, context) => {
		const job = await retryWarehouseProvisioning(context.userId, context.chatId);
		return {
			_version: '1',
			setup: {
				provider: job.provider,
				status: job.status,
				failedStatus: job.failedStatus,
				error: job.error,
				logs: job.logs,
				businessContextProvided: job.businessContextProvided,
				canRetry: job.canRetry,
			},
		};
	},
	toModelOutput: () => ({
		type: 'text',
		value: 'The warehouse setup restarted in the background. Call wait_for_warehouse_setup to follow it.',
	}),
});
