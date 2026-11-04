import { describe, expect, it, vi } from 'vitest';

import {
	canFinishDeployOnboarding,
	findCreatedOnboardingProject,
	hasOnboardingCloudAccess,
	shouldReturnToOnboarding,
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
		'requires completed project setup and an onboarding milestone',
		(projectSetupComplete, progress, warehouseReady, expected) => {
			expect(isOnboardingComplete(projectSetupComplete, progress, warehouseReady)).toBe(expected);
		},
	);

	it('finishes when project setup is complete and no warehouse setup is active', () => {
		expect(isOnboardingComplete(true, null, false, false)).toBe(true);
		expect(isOnboardingComplete(true, null, false, true)).toBe(false);
		expect(isOnboardingComplete(false, null, false, false)).toBe(false);
	});
});

describe('canFinishDeployOnboarding', () => {
	it('waits for the deployed project and Cloud access', () => {
		expect(canFinishDeployOnboarding(true, false, { flow: 'local', step: 3 }, false)).toBe(false);
		expect(canFinishDeployOnboarding(false, true, { flow: 'new', step: 4 }, false)).toBe(false);
		expect(canFinishDeployOnboarding(true, true, { flow: 'local', step: 3 }, false)).toBe(true);
	});

	it('does not apply to a GitHub import', () => {
		expect(canFinishDeployOnboarding(true, true, { flow: 'github', step: 2 }, false)).toBe(false);
	});
});

describe('shouldReturnToOnboarding', () => {
	it('returns to onboarding only when the project is unfinished and Cloud access is absent', () => {
		expect(
			shouldReturnToOnboarding({
				cloudBillingEnabled: true,
				hasProject: true,
				setupComplete: false,
				hasAccess: false,
			}),
		).toBe(true);
		expect(
			shouldReturnToOnboarding({
				cloudBillingEnabled: true,
				hasProject: true,
				setupComplete: false,
				hasAccess: true,
			}),
		).toBe(false);
		expect(
			shouldReturnToOnboarding({
				cloudBillingEnabled: true,
				hasProject: true,
				setupComplete: true,
				hasAccess: false,
			}),
		).toBe(false);
		expect(
			shouldReturnToOnboarding({
				cloudBillingEnabled: false,
				hasProject: true,
				setupComplete: false,
				hasAccess: false,
			}),
		).toBe(false);
		expect(
			shouldReturnToOnboarding({
				cloudBillingEnabled: true,
				hasProject: true,
				setupComplete: undefined,
				hasAccess: undefined,
			}),
		).toBe(false);
	});
});

describe('hasOnboardingCloudAccess', () => {
	it('accepts a billing bypass when the organization has no current billing access', () => {
		expect(hasOnboardingCloudAccess(true, { hasAccess: false, bypassBilling: true })).toBe(true);
	});

	it('still requires billing access when bypass is off', () => {
		expect(hasOnboardingCloudAccess(true, { hasAccess: false, bypassBilling: false })).toBe(false);
		expect(hasOnboardingCloudAccess(true, { hasAccess: true, bypassBilling: false })).toBe(true);
		expect(hasOnboardingCloudAccess(true, undefined)).toBe(false);
	});

	it('does not require billing when cloud billing is disabled', () => {
		expect(hasOnboardingCloudAccess(false, undefined)).toBe(true);
	});
});

describe('findCreatedOnboardingProject', () => {
	const onboardingStartedAt = Date.parse('2026-10-28T10:00:00Z');
	const existing = {
		id: 'existing',
		createdAt: new Date('2026-10-01T10:00:00Z'),
		updatedAt: new Date('2026-10-28T11:00:00Z'),
		deployedAt: null,
	};
	const deployed = {
		id: 'deployed',
		createdAt: new Date('2026-10-28T10:30:00Z'),
		updatedAt: new Date('2026-10-28T10:30:00Z'),
		deployedAt: new Date('2026-10-28T10:30:00Z'),
	};

	it('returns the project deployed after onboarding started', () => {
		expect(findCreatedOnboardingProject([existing, deployed], onboardingStartedAt)).toEqual(deployed);
	});

	it('falls back to the creation time for deployments recorded before deployedAt existed', () => {
		const legacyDeployment = { ...deployed, deployedAt: null };

		expect(findCreatedOnboardingProject([existing, legacyDeployment], onboardingStartedAt)).toEqual(
			legacyDeployment,
		);
	});

	it('returns a project redeployed after onboarding started', () => {
		const redeployed = {
			...existing,
			updatedAt: new Date('2026-10-01T10:00:00Z'),
			deployedAt: new Date('2026-10-28T11:00:00Z'),
		};

		expect(findCreatedOnboardingProject([redeployed], onboardingStartedAt)).toEqual(redeployed);
	});

	it('prefers the latest deployment', () => {
		const redeployed = { ...existing, deployedAt: new Date('2026-10-28T11:00:00Z') };

		expect(findCreatedOnboardingProject([deployed, redeployed], onboardingStartedAt)).toEqual(redeployed);
	});

	it('does not treat a rename or other project update as a deployment', () => {
		expect(findCreatedOnboardingProject([existing], onboardingStartedAt)).toBeNull();
	});

	it('does not treat an earlier deployment as the onboarding project', () => {
		const previouslyDeployed = { ...existing, deployedAt: new Date('2026-10-01T10:00:00Z') };

		expect(findCreatedOnboardingProject([previouslyDeployed], onboardingStartedAt)).toBeNull();
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
