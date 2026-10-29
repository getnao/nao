import { onboardingCommand } from '@nao/shared/tools';
import { tool } from 'ai';

export default tool<onboardingCommand.Input, onboardingCommand.Output>({
	description:
		'Display an exact terminal command in a clean, copyable command block. Use this instead of Markdown code fences during onboarding.',
	inputSchema: onboardingCommand.InputSchema,
	outputSchema: onboardingCommand.OutputSchema,
	execute: async ({ command }) => ({ _version: '1', command }),
	toModelOutput: ({ output }) => ({
		type: 'text',
		value: `Displayed this command to the user: ${output.command}. Continue this turn and call clarification to ask whether the step succeeded.`,
	}),
});
