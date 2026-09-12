import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	resolveEffectiveUserGroupAccess: vi.fn(),
}));

vi.mock('../src/queries/user-group.queries', () => ({
	resolveEffectiveUserGroupAccess: mocks.resolveEffectiveUserGroupAccess,
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
		mocks.resolveEffectiveUserGroupAccess.mockResolvedValue({
			features: ['story-creation'],
			databaseAccess: { mode: 'restricted', strict: false, grants: [], patterns: [] },
			docsAccess: { mode: 'restricted', grants: [{ kind: 'folder', path: 'finance' }] },
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
		});
	});

	it('resolves group policies without an unlimited-groups entitlement', async () => {
		await expect(getEffectiveUserGroupAccess('project-id', 'user-id')).resolves.toEqual({
			features: {
				'story-creation': true,
				'automation-creation': false,
			},
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
			databaseAccess: { mode: 'restricted', strict: false, grants: [], patterns: [] },
			docsAccess: { mode: 'restricted', grants: [{ kind: 'folder', path: 'finance' }] },
		});
		expect(mocks.resolveEffectiveUserGroupAccess).toHaveBeenCalledWith('project-id', 'user-id');
	});

	it('returns typed flags for effective grants', async () => {
		await expect(getEffectiveUserGroupFeatureFlags('project-id', 'user-id')).resolves.toEqual({
			'story-creation': true,
			'automation-creation': false,
		});
		await expect(getEffectiveUserGroupAccess('project-id', 'user-id')).resolves.toMatchObject({
			databaseAccess: { mode: 'restricted', strict: false, grants: [], patterns: [] },
			docsAccess: { mode: 'restricted', grants: [{ kind: 'folder', path: 'finance' }] },
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
		});
	});

	it('allows and denies feature checks', async () => {
		await expect(hasUserGroupFeature('project-id', 'user-id', 'story-creation')).resolves.toBe(true);
		await expect(assertUserGroupFeature('project-id', 'user-id', 'automation-creation')).rejects.toMatchObject({
			codeMessage: 'FORBIDDEN',
			message: 'Automation creation is not enabled for your user group.',
		});
	});
});
