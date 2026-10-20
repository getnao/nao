import { onboardingAgentPrompt } from '@nao/shared/tools';
import { tool } from 'ai';

export default tool<onboardingAgentPrompt.Input, onboardingAgentPrompt.Output>({
	description:
		'Display an exact prompt in a compact, copyable card for the user to give to their local coding agent.',
	inputSchema: onboardingAgentPrompt.InputSchema,
	outputSchema: onboardingAgentPrompt.OutputSchema,
	execute: async ({ prompt }) => ({ _version: '1', prompt }),
	toModelOutput: () => ({
		type: 'text',
		value: 'Displayed the local-agent prompt to the user. Continue with the next onboarding step.',
	}),
});
