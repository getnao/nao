import { waitForWarehouseSetup } from '@nao/shared/tools';

import { waitForWarehouseSetup as waitForSetup } from '../../services/warehouse-provisioning';
import { createTool } from '../../utils/tools';
import { formatWarehouseSetupForAgent } from '../../utils/warehouse-setup';

export default createTool<waitForWarehouseSetup.Input, waitForWarehouseSetup.Output>({
	description:
		'Wait for the background warehouse setup of this conversation to need attention: connection verified, stopped, ready, or still running after a few minutes. Returns its status, error, technical cause and latest command logs.',
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
