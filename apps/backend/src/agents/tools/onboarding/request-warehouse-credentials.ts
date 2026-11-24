import { requestWarehouseCredentials } from '@nao/shared/tools';
import { tool } from 'ai';

export default tool<requestWarehouseCredentials.Input, requestWarehouseCredentials.Output>({
	description:
		'Display the secure connection form for the warehouse provider selected during onboarding. The form validates the credentials, starts the warehouse setup and shows its progress. Never request or handle credential values in chat.',
	inputSchema: requestWarehouseCredentials.InputSchema,
	outputSchema: requestWarehouseCredentials.OutputSchema,
	execute: async ({ provider }) => ({
		_version: '1',
		provider,
		status: 'credentials-required',
	}),
	toModelOutput: ({ output }) => ({
		type: 'text',
		value: `Displayed the secure ${output.provider} connection form. The turn ends here; a user message reports when they submit it.`,
	}),
});
