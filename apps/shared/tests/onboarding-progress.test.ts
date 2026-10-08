import { describe, expect, it } from 'vitest';

import { onboardingCommand, onboardingProgress } from '../src/tools';

describe('onboarding progress', () => {
	it('accepts each flow through its final supported step', () => {
		expect(onboardingProgress.InputSchema.parse({ flow: 'new', step: 0 })).toEqual({ flow: 'new', step: 0 });
		expect(onboardingProgress.InputSchema.parse({ flow: 'new', step: 4 })).toEqual({ flow: 'new', step: 4 });
		expect(onboardingProgress.InputSchema.parse({ flow: 'local', step: 4 })).toEqual({ flow: 'local', step: 4 });
		expect(onboardingProgress.InputSchema.parse({ flow: 'github', step: 2 })).toEqual({ flow: 'github', step: 2 });
		expect(onboardingProgress.InputSchema.parse({ flow: 'database', step: 2 })).toEqual({
			flow: 'database',
			step: 2,
		});
	});

	it.each([
		['new', 5],
		['local', 5],
		['github', 3],
		['database', 3],
	] as const)('rejects out-of-range steps for the %s flow', (flow, step) => {
		expect(() => onboardingProgress.InputSchema.parse({ flow, step })).toThrow();
		expect(() => onboardingProgress.OutputSchema.parse({ flow, step })).toThrow();
	});
});

describe('onboarding command', () => {
	it('preserves multiline commands', () => {
		const command = 'cd <your-project-folder>\nnao debug';
		expect(onboardingCommand.InputSchema.parse({ command })).toEqual({ command });
	});
});
