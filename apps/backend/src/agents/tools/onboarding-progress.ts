import { onboardingProgress } from '@nao/shared/tools';
import { tool } from 'ai';

export default tool<onboardingProgress.Input, onboardingProgress.Output>({
	description:
		'Record completed onboarding progress. Call this whenever the user selects a flow or completes another onboarding step.',
	inputSchema: onboardingProgress.InputSchema,
	outputSchema: onboardingProgress.OutputSchema,
	execute: async ({ flow, step }) => ({ _version: '1', flow, step }),
	toModelOutput: ({ output }) => ({
		type: 'text',
		value: `Onboarding progress recorded for the ${output.flow} flow at step ${output.step}.`,
	}),
});
