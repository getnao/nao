import { requestWarehouseCredentials } from '@nao/shared/tools';
import { tool } from 'ai';

export default tool<requestWarehouseCredentials.Input, requestWarehouseCredentials.Output>({
	description:
		'Display the secure credential card for the warehouse provider selected during onboarding. Never request or handle credential values in chat.',
	inputSchema: requestWarehouseCredentials.InputSchema,
	outputSchema: requestWarehouseCredentials.OutputSchema,
	execute: async ({ provider }) => ({
		_version: '1',
		provider,
		status: 'credentials-required',
	}),
	toModelOutput: ({ output }) => ({
		type: 'text',
		value: `Displayed the secure ${output.provider} credential card. End this turn and wait for the card to report its result automatically.`,
	}),
});
