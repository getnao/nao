import { describe, expect, it } from 'vitest';

import {
	canShareToEntireProject,
	DEFAULT_PROJECT_SHARING_SETTINGS,
	findProjectWideSharesToRevoke,
	getCustomGroupMemberships,
	getSavedGroupProjectSharing,
	resolveProjectSharingPolicy,
	withGroupProjectSharing,
} from './project-sharing-policy';

const memberships = [
	{ groupId: 'client-a', userId: 'alice' },
	{ groupId: 'client-a', userId: 'bob' },
	{ groupId: 'client-b', userId: 'carol' },
	{ groupId: 'analysts', userId: 'alice' },
	{ groupId: 'analysts', userId: 'dave' },
];

describe('canShareToEntireProject', () => {
	it('falls back to the All Users default when no group overrides it', () => {
		expect(canShareToEntireProject(DEFAULT_PROJECT_SHARING_SETTINGS, ['client-a'])).toBe(true);
		expect(canShareToEntireProject({ defaultAllowed: false, groups: {} }, ['client-a'])).toBe(false);
	});

	it('lets an explicit allow override a restrictive default', () => {
		const settings = { defaultAllowed: false, groups: { analysts: 'allowed' as const } };
		expect(canShareToEntireProject(settings, ['analysts'])).toBe(true);
	});

	it('lets an explicit block win over any explicit allow', () => {
		const settings = {
			defaultAllowed: true,
			groups: { analysts: 'allowed' as const, 'client-a': 'blocked' as const },
		};
		expect(canShareToEntireProject(settings, ['analysts', 'client-a'])).toBe(false);
	});
});

describe('resolveProjectSharingPolicy', () => {
	it('is unrestricted when sharing to the entire project is allowed', () => {
		expect(resolveProjectSharingPolicy(DEFAULT_PROJECT_SHARING_SETTINGS, memberships, 'alice')).toEqual({
			canShareToProject: true,
		});
	});

	it('limits sharing to the groups of the user and their members', () => {
		const settings = { defaultAllowed: true, groups: { 'client-a': 'blocked' as const } };
		const policy = resolveProjectSharingPolicy(settings, memberships, 'alice');
		expect(policy).toEqual({
			canShareToProject: false,
			shareableGroupIds: new Set(['client-a', 'analysts']),
			shareableMemberIds: new Set(['bob', 'dave']),
		});
	});
});

describe('findProjectWideSharesToRevoke', () => {
	const shares = [
		{ id: 'alice-project', userId: 'alice', visibility: 'project' },
		{ id: 'alice-specific', userId: 'alice', visibility: 'specific' },
		{ id: 'carol-project', userId: 'carol', visibility: 'project' },
	];

	it('revokes project-wide shares of members who can no longer share to the entire project', () => {
		const settings = { defaultAllowed: true, groups: { 'client-a': 'blocked' as const } };
		expect(findProjectWideSharesToRevoke(shares, settings, memberships).map((share) => share.id)).toEqual([
			'alice-project',
		]);
	});

	it('revokes every project-wide share when the All Users default is turned off', () => {
		const settings = { defaultAllowed: false, groups: {} };
		expect(findProjectWideSharesToRevoke(shares, settings, memberships).map((share) => share.id)).toEqual([
			'alice-project',
			'carol-project',
		]);
	});
});

describe('getCustomGroupMemberships', () => {
	it('ignores memberships of the All Users group', () => {
		const overview = {
			groups: [
				{ id: 'all', isDefault: true },
				{ id: 'client-a', isDefault: false },
			],
			memberships: [
				{ groupId: 'all', userId: 'alice' },
				{ groupId: 'client-a', userId: 'alice' },
			],
		};
		expect(getCustomGroupMemberships(overview)).toEqual([{ groupId: 'client-a', userId: 'alice' }]);
	});
});

describe('group project sharing settings', () => {
	it('stores the All Users value as the default', () => {
		const settings = withGroupProjectSharing(
			DEFAULT_PROJECT_SHARING_SETTINGS,
			{ id: 'all', isDefault: true },
			'blocked',
		);
		expect(settings.defaultAllowed).toBe(false);
		expect(getSavedGroupProjectSharing(settings, { id: 'all', isDefault: true })).toBe('blocked');
	});

	it('drops the override when a group inherits again', () => {
		const group = { id: 'client-a', isDefault: false };
		const blocked = withGroupProjectSharing(DEFAULT_PROJECT_SHARING_SETTINGS, group, 'blocked');
		expect(getSavedGroupProjectSharing(blocked, group)).toBe('blocked');
		expect(withGroupProjectSharing(blocked, group, 'inherit').groups).toEqual({});
	});
});
