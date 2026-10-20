import { describe, expect, it, vi } from 'vitest';

import { getCompletedSteps, isOnboardingComplete } from './onboarding-progress';

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

describe('getCompletedSteps', () => {
	it.each([
		[undefined, 0],
		['queued', 1],
		['initializing', 1],
		['debugging', 2],
		['syncing', 3],
		['registering', 4],
		['awaiting_context', 4],
		['finalizing', 4],
		['publishing', 4],
		['ready', 5],
	] as const)('tracks database provisioning status %s', (status, expected) => {
		expect(getCompletedSteps({ flow: 'database', step: 0 }, 5, false, status)).toBe(expected);
	});
});
