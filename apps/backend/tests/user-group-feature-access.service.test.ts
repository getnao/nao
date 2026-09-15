import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	hasFeature: vi.fn(),
	resolveEffectiveUserGroupAccess: vi.fn(),
}));

vi.mock('../src/queries/user-group.queries', () => ({
	resolveEffectiveUserGroupAccess: mocks.resolveEffectiveUserGroupAccess,
}));
vi.mock('../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: { userGroups: 'user-groups' },
}));

import {
	assertUserGroupFeature,
	getEffectiveUserGroupAccess,
	getEffectiveUserGroupFeatureFlags,
	hasUserGroupFeature,
} from '../src/services/user-group-feature-access.service';

describe('user group feature access service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.hasFeature.mockResolvedValue(true);
		mocks.resolveEffectiveUserGroupAccess.mockResolvedValue({
			features: ['story-creation'],
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
		});
	});

	it('fails open without querying groups when user groups are unlicensed', async () => {
		mocks.hasFeature.mockResolvedValue(false);

		await expect(getEffectiveUserGroupAccess('project-id', 'user-id')).resolves.toEqual({
			features: {
				'story-creation': true,
				'automation-creation': true,
			},
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
				canChange: true,
			},
		});
		await expect(hasUserGroupFeature('project-id', 'user-id', 'story-creation')).resolves.toBe(true);
		expect(mocks.resolveEffectiveUserGroupAccess).not.toHaveBeenCalled();
	});

	it('returns typed flags for licensed effective grants', async () => {
		await expect(getEffectiveUserGroupFeatureFlags('project-id', 'user-id')).resolves.toEqual({
			'story-creation': true,
			'automation-creation': false,
		});
		await expect(getEffectiveUserGroupAccess('project-id', 'user-id')).resolves.toMatchObject({
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
		});
	});

	it('allows and denies licensed feature checks', async () => {
		await expect(hasUserGroupFeature('project-id', 'user-id', 'story-creation')).resolves.toBe(true);
		await expect(assertUserGroupFeature('project-id', 'user-id', 'automation-creation')).rejects.toMatchObject({
			codeMessage: 'FORBIDDEN',
			message: 'Automation creation is not enabled for your user group.',
		});
	});
});
