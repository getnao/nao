import { waitForWarehouseSetup } from '@nao/shared/tools';

import { waitForWarehouseSetup as waitForSetup } from '../../../services/onboarding/warehouse-provisioning';
import { formatWarehouseSetupForAgent } from '../../../utils/onboarding/warehouse-setup';
import { createTool } from '../../../utils/tools';

export default createTool<waitForWarehouseSetup.Input, waitForWarehouseSetup.Output>({
	description:
		'Wait for the background warehouse setup of this conversation to need attention: connection verified, stopped, ready, or still running after a few minutes. Returns its status, error and latest command logs.',
	inputSchema: waitForWarehouseSetup.InputSchema,
	outputSchema: waitForWarehouseSetup.OutputSchema,
	execute: async (_input, context, { abortSignal }) => ({
		_version: '1',
		...(await waitForSetup(context.userId, context.chatId, abortSignal)),
	}),
	toModelOutput: ({ output }) => ({
		type: 'text',
		value: [
			`Outcome: ${output.outcome}`,
			...(output.setup ? [formatWarehouseSetupForAgent(output.setup)] : []),
		].join('\n\n'),
	}),
});
