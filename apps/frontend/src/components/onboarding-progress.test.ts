import { describe, expect, it, vi } from 'vitest';

import {
	findCreatedOnboardingProject,
	getCompletedSteps,
	isDeployStepReached,
	isOnboardingComplete,
} from './onboarding-progress';

vi.mock('@/main', () => ({ trpc: {} }));

describe('isDeployStepReached', () => {
	it.each([
		[null, false],
		[{ flow: 'new', step: 2 }, false],
		[{ flow: 'new', step: 3 }, true],
		[{ flow: 'local', step: 3 }, true],
		[{ flow: 'github', step: 3 }, false],
		[{ flow: 'database', step: 3 }, false],
	] as const)('detects the new and local deployment milestone', (progress, expected) => {
		expect(isDeployStepReached(progress)).toBe(expected);
	});
});

describe('isOnboardingComplete', () => {
	it.each([
		[false, { flow: 'local', step: 4 }, false, false],
		[true, { flow: 'local', step: 2 }, false, false],
		[true, { flow: 'local', step: 3 }, false, true],
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

describe('findCreatedOnboardingProject', () => {
	const onboardingStartedAt = Date.parse('2026-10-28T10:00:00Z');
	const existing = { id: 'existing', createdAt: new Date('2026-10-01T10:00:00Z') };
	const deployed = { id: 'deployed', createdAt: new Date('2026-10-28T10:30:00Z') };

	it('returns the project created after onboarding started', () => {
		expect(findCreatedOnboardingProject([existing, deployed], onboardingStartedAt)).toEqual(deployed);
	});

	it('does not treat an earlier project as the onboarding project', () => {
		expect(findCreatedOnboardingProject([existing], onboardingStartedAt)).toBeNull();
	});

	it('waits until the onboarding start is known', () => {
		expect(findCreatedOnboardingProject([existing, deployed], undefined)).toBeNull();
	});
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
