import { requestWarehouseSelection } from '@nao/shared/tools';
import { tool } from 'ai';

export default tool<requestWarehouseSelection.Input, requestWarehouseSelection.Output>({
	description: `Ask the user "${requestWarehouseSelection.QUESTION}" with every supported database as a one-click option. Use this instead of clarification whenever you need to know which database the user is using.`,
	inputSchema: requestWarehouseSelection.InputSchema,
	outputSchema: requestWarehouseSelection.OutputSchema,
	execute: async () => ({ _version: '1', success: true }),
	toModelOutput: () => ({
		type: 'text',
		value: 'Warehouse selection requested. Stop and wait for the user to choose.',
	}),
});
