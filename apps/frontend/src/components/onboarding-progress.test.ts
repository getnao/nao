import { describe, expect, it, vi } from 'vitest';

import { isOnboardingComplete } from './onboarding-progress';

vi.mock('@/main', () => ({ trpc: {} }));

describe('isOnboardingComplete', () => {
	it.each([
		[false, { flow: 'local', step: 4 }, false, false],
		[true, { flow: 'local', step: 3 }, false, false],
		[true, { flow: 'local', step: 4 }, false, true],
		[true, { flow: 'github', step: 2 }, false, true],
		[true, { flow: 'github', step: 4 }, false, false],
		[true, { flow: 'database', step: 4 }, false, false],
		[true, { flow: 'database', step: 2 }, true, true],
	] as const)(
		'requires a project and a completed setup milestone',
		(hasProject, progress, warehouseReady, expected) => {
			expect(isOnboardingComplete(hasProject, progress, warehouseReady)).toBe(expected);
		},
	);
});
