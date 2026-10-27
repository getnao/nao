import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	findCreatedOnboardingProject,
	getOnboardingInitialProjectIds,
	getCompletedSteps,
	isDeployStepReached,
	isOnboardingComplete,
	setOnboardingInitialProjectIds,
} from './onboarding-progress';

vi.mock('@/main', () => ({ trpc: {} }));

afterEach(() => {
	vi.unstubAllGlobals();
});

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
	it('returns the project added after onboarding started', () => {
		const projects = [{ id: 'existing' }, { id: 'created' }];

		expect(findCreatedOnboardingProject(projects, new Set(['existing']))).toEqual({ id: 'created' });
	});

	it('does not treat an existing project as the onboarding project', () => {
		expect(findCreatedOnboardingProject([{ id: 'existing' }], new Set(['existing']))).toBeNull();
	});
});

describe('onboarding initial project storage', () => {
	it('restores the project baseline for the same conversation', () => {
		const storedValues = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => storedValues.get(key) ?? null,
			setItem: (key: string, value: string) => storedValues.set(key, value),
		});

		setOnboardingInitialProjectIds('chat-1', new Set(['existing']));

		const restoredProjectIds = getOnboardingInitialProjectIds('chat-1');
		expect([...restoredProjectIds!]).toEqual(['existing']);
		expect(findCreatedOnboardingProject([{ id: 'existing' }, { id: 'deployed' }], restoredProjectIds)).toEqual({
			id: 'deployed',
		});
		expect(getOnboardingInitialProjectIds('chat-2')).toBeNull();
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
