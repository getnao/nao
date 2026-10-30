import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	freeTierEnabled: false,
	seatLimit: 3 as number | null,
	tier: 'free' as 'free' | 'trial' | 'unlimited' | 'bypass' | 'team',
	orgMembers: new Map<string, 'admin' | 'user' | 'viewer'>(),
	projectMembers: new Map<string, 'admin' | 'context_admin' | 'user' | 'viewer'>(),
	seatCandidates: [] as Array<{ id: string }>,
	addOrgMember: vi.fn(),
	addOrgMemberIfMissing: vi.fn(),
	addProjectMember: vi.fn(),
	addProjectMemberWithUserGroups: vi.fn(),
	getOrgMember: vi.fn(),
	getProjectMember: vi.fn(),
	getOrganizationById: vi.fn(),
	getProjectById: vi.fn(),
	getUser: vi.fn(),
	listOrganizationSeatStates: vi.fn(),
	setOrganizationSeatSelection: vi.fn(),
	syncOrganizationSeatState: vi.fn(),
	recordOrganizationJoinCandidate: vi.fn(),
	recordProjectJoinCandidate: vi.fn(),
	removeOrgMember: vi.fn(),
	removeOrgMemberFromProjects: vi.fn(),
	removeProjectMember: vi.fn(),
	stripeUpdate: vi.fn(),
	locks: new Map<string, Promise<unknown>>(),
}));

vi.mock('../src/env', () => ({
	env: {},
	isCloudFreeTierEnabled: () => mocks.freeTierEnabled,
}));
vi.mock('../src/utils/keyed-lock', () => ({
	withKeyedLock: async <T>(key: string, operation: () => Promise<T>): Promise<T> => {
		const previous = mocks.locks.get(key) ?? Promise.resolve();
		const current = previous.catch(() => undefined).then(operation);
		mocks.locks.set(key, current);
		try {
			return await current;
		} finally {
			if (mocks.locks.get(key) === current) {
				mocks.locks.delete(key);
			}
		}
	},
}));
vi.mock('../src/queries/organization.queries', () => ({
	addOrgMember: mocks.addOrgMember,
	addOrgMemberIfMissing: mocks.addOrgMemberIfMissing,
	countOrgAdmins: vi.fn(async () => 2),
	getOrgMember: mocks.getOrgMember,
	getOrganizationById: mocks.getOrganizationById,
	listOrgProjectsForContextCleanup: vi.fn(async () => []),
	listOrgSeatCandidates: vi.fn(async () => mocks.seatCandidates),
	removeOrgMember: mocks.removeOrgMember,
	removeOrgMemberFromProjects: mocks.removeOrgMemberFromProjects,
	updateOrgMemberRole: vi.fn(async (_orgId, userId, role) => {
		mocks.orgMembers.set(userId, role);
		updateSeatCandidate(userId, role);
	}),
}));
vi.mock('../src/queries/project.queries', () => ({
	addProjectMember: mocks.addProjectMember,
	checkProjectHasMoreThanOneAdmin: vi.fn(async () => true),
	getProjectMember: mocks.getProjectMember,
	getProjectById: mocks.getProjectById,
	getUserRoleInProject: vi.fn(async (_projectId, userId) => mocks.projectMembers.get(userId) ?? null),
	removeProjectMember: mocks.removeProjectMember,
	updateProjectMemberRole: vi.fn(async (_projectId, userId, role) => {
		mocks.projectMembers.set(userId, role);
		updateSeatCandidate(userId, role);
	}),
}));
vi.mock('../src/queries/user.queries', () => ({
	getUser: mocks.getUser,
}));
vi.mock('../src/queries/organization-seat-state.queries', () => ({
	listOrganizationSeatStates: mocks.listOrganizationSeatStates,
	setOrganizationSeatSelection: mocks.setOrganizationSeatSelection,
	syncOrganizationSeatState: mocks.syncOrganizationSeatState,
}));
vi.mock('../src/services/context-explorer-git.service', () => ({
	cleanupContextWorktree: vi.fn(),
}));
vi.mock('../src/services/cloud-billing-access.service', () => ({
	getOrganizationCloudEntitlement: vi.fn(async () => {
		const count = mocks.seatCandidates.length;
		return {
			tier: mocks.tier,
			seatUserCount: count,
			seatQuantity: mocks.tier === 'team' ? mocks.seatLimit : null,
			seatLimit: mocks.seatLimit,
			availableSeats: mocks.seatLimit === null ? null : Math.max(0, mocks.seatLimit - count),
			overCapacity: mocks.seatLimit !== null && count > mocks.seatLimit,
		};
	}),
}));
vi.mock('../src/services/credit-grant.service', () => ({
	recordOrganizationJoinCandidate: mocks.recordOrganizationJoinCandidate,
	recordProjectJoinCandidate: mocks.recordProjectJoinCandidate,
}));
vi.mock('../src/services/project-user-group-membership.service', () => ({
	addProjectMemberWithUserGroups: mocks.addProjectMemberWithUserGroups,
}));
vi.mock('../src/services/stripe.service', () => ({
	updateCloudSubscriptionQuantity: mocks.stripeUpdate,
}));

import {
	addOrganizationMember,
	addOrganizationMemberIfMissing,
	addProjectMember,
	putOrganizationMember,
	removeOrganizationMember,
} from '../src/services/membership.service';

describe('membership service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.freeTierEnabled = false;
		mocks.seatLimit = 3;
		mocks.tier = 'free';
		mocks.orgMembers.clear();
		mocks.projectMembers.clear();
		mocks.seatCandidates = [];
		mocks.locks.clear();
		mocks.getOrganizationById.mockResolvedValue({ id: 'org-1' });
		mocks.getProjectById.mockResolvedValue({ id: 'project-1', orgId: 'org-1', path: null });
		mocks.getUser.mockResolvedValue({ id: 'user-1' });
		mocks.getOrgMember.mockImplementation(async (_orgId, userId) => {
			const role = mocks.orgMembers.get(userId);
			return role ? { orgId: 'org-1', userId, role } : null;
		});
		mocks.getProjectMember.mockImplementation(async (_projectId, userId) => {
			const role = mocks.projectMembers.get(userId);
			return role ? { projectId: 'project-1', userId, role } : null;
		});
		mocks.addOrgMember.mockImplementation(async (member) => {
			mocks.orgMembers.set(member.userId, member.role);
			updateSeatCandidate(member.userId, member.role);
			return member;
		});
		mocks.addOrgMemberIfMissing.mockImplementation(async (member) => {
			if (!mocks.orgMembers.has(member.userId)) {
				mocks.orgMembers.set(member.userId, member.role);
				updateSeatCandidate(member.userId, member.role);
			}
		});
		mocks.addProjectMember.mockImplementation(async (member) => {
			mocks.projectMembers.set(member.userId, member.role);
			updateSeatCandidate(member.userId, member.role);
			return member;
		});
		mocks.addProjectMemberWithUserGroups.mockImplementation(async (member) => {
			mocks.projectMembers.set(member.userId, member.role);
			updateSeatCandidate(member.userId, member.role);
			return member;
		});
		mocks.removeOrgMember.mockImplementation(async (_orgId, userId) => {
			mocks.orgMembers.delete(userId);
			mocks.seatCandidates = mocks.seatCandidates.filter(({ id }) => id !== userId);
		});
		mocks.listOrganizationSeatStates.mockResolvedValue([]);
		mocks.setOrganizationSeatSelection.mockResolvedValue({});
		mocks.syncOrganizationSeatState.mockResolvedValue({ changed: false });
	});

	it('records a join candidate after adding a missing organization member', async () => {
		const member = { orgId: 'org-1', userId: 'user-1', role: 'user' as const };

		await addOrganizationMemberIfMissing(member);

		expect(mocks.addOrgMemberIfMissing).toHaveBeenCalledWith(member);
		expect(mocks.addOrgMemberIfMissing).toHaveBeenCalledTimes(1);
		expect(mocks.recordOrganizationJoinCandidate).toHaveBeenCalledWith('org-1', 'user-1');
		expect(mocks.recordOrganizationJoinCandidate).toHaveBeenCalledTimes(1);
		expect(mocks.addOrgMemberIfMissing.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.recordOrganizationJoinCandidate.mock.invocationCallOrder[0],
		);
	});

	it.each([
		{ description: 'without groups', groupIds: [] },
		{ description: 'with groups', groupIds: ['analysts'] },
	])('records a join candidate after adding a project member $description', async ({ groupIds }) => {
		const member = { projectId: 'project-1', userId: 'user-1', role: 'user' as const };

		await addProjectMember(member, groupIds);

		const persistMember = groupIds.length ? mocks.addProjectMemberWithUserGroups : mocks.addProjectMember;
		if (groupIds.length) {
			expect(mocks.addProjectMemberWithUserGroups).toHaveBeenCalledWith(member, groupIds);
			expect(mocks.addProjectMember).not.toHaveBeenCalled();
		} else {
			expect(mocks.addProjectMember).toHaveBeenCalledWith(member);
			expect(mocks.addProjectMemberWithUserGroups).not.toHaveBeenCalled();
		}
		expect(persistMember).toHaveBeenCalledTimes(1);
		expect(mocks.recordProjectJoinCandidate).toHaveBeenCalledWith('project-1', 'user-1');
		expect(mocks.recordProjectJoinCandidate).toHaveBeenCalledTimes(1);
		expect(persistMember.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.recordProjectJoinCandidate.mock.invocationCallOrder[0],
		);
	});

	it.each(['trial', 'unlimited', 'bypass'] as const)('activates directly on %s', async (tier) => {
		mocks.freeTierEnabled = true;
		mocks.tier = tier;
		mocks.seatLimit = null;

		await expect(addOrganizationMember(member('user-1'))).resolves.toMatchObject({
			role: 'user',
			outcome: { status: 'activated', role: 'user', usedExistingSeat: false },
		});
	});

	it('activates into available limited capacity and uses a freed replacement seat', async () => {
		mocks.freeTierEnabled = true;
		mocks.seatCandidates = [{ id: 'existing-1' }, { id: 'existing-2' }];

		const first = await addOrganizationMember(member('user-1'));
		expect(first).toMatchObject({
			role: 'user',
			outcome: { status: 'activated', usedExistingSeat: true },
		});

		await removeOrganizationMember('org-1', 'user-1');
		const replacement = await addOrganizationMember(member('replacement'));
		expect(replacement).toMatchObject({
			role: 'user',
			outcome: { status: 'activated', usedExistingSeat: true },
		});
		expect(mocks.stripeUpdate).not.toHaveBeenCalled();
	});

	it('stores a new non-purchasing addition as viewer when capacity is full', async () => {
		mocks.freeTierEnabled = true;
		mocks.seatCandidates = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

		await expect(addProjectMember(projectMember('user-1'))).resolves.toEqual({
			userId: 'user-1',
			role: 'viewer',
			outcome: { status: 'viewer_fallback', role: 'viewer', reason: 'capacity_full' },
		});
		expect(mocks.projectMembers.get('user-1')).toBe('viewer');
		expect(mocks.seatCandidates).toHaveLength(3);
	});

	it('rejects a non-purchasing viewer promotion without changing the stored role', async () => {
		mocks.freeTierEnabled = true;
		mocks.seatCandidates = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
		mocks.orgMembers.set('user-1', 'viewer');

		await expect(putOrganizationMember('org-1', 'user-1', 'user')).resolves.toEqual({
			userId: 'user-1',
			role: 'viewer',
			outcome: { status: 'promotion_rejected', role: 'viewer', reason: 'capacity_full' },
		});
		expect(mocks.orgMembers.get('user-1')).toBe('viewer');
	});

	it('returns purchase_required only for an opted-in interactive promotion', async () => {
		mocks.freeTierEnabled = true;
		mocks.seatCandidates = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
		mocks.orgMembers.set('user-1', 'viewer');

		await expect(
			putOrganizationMember('org-1', 'user-1', 'user', { capacityBehavior: 'purchase_required' }),
		).resolves.toEqual({
			userId: 'user-1',
			role: 'viewer',
			outcome: { status: 'purchase_required', requestedRole: 'user', targetSeatQuantity: 4 },
		});
		expect(mocks.orgMembers.get('user-1')).toBe('viewer');
		expect(mocks.stripeUpdate).not.toHaveBeenCalled();
	});

	it('serializes concurrent attempts so a new addition never becomes read-only', async () => {
		mocks.freeTierEnabled = true;
		mocks.seatCandidates = [{ id: 'a' }, { id: 'b' }];

		const [first, second] = await Promise.all([
			addOrganizationMember(member('first')),
			addOrganizationMember(member('second')),
		]);

		expect([first.role, second.role].sort()).toEqual(['user', 'viewer']);
		const viewer = first.role === 'viewer' ? first : second;
		expect(mocks.seatCandidates.some(({ id }) => id === viewer.userId)).toBe(false);
		expect(mocks.seatCandidates).toHaveLength(3);
	});

	it('allows a downgrade, clears its selection, synchronizes state, and never calls Stripe', async () => {
		mocks.freeTierEnabled = true;
		mocks.orgMembers.set('user-1', 'user');
		mocks.seatCandidates = [{ id: 'user-1' }];

		await expect(putOrganizationMember('org-1', 'user-1', 'viewer')).resolves.toMatchObject({
			role: 'viewer',
			outcome: null,
		});
		expect(mocks.setOrganizationSeatSelection).toHaveBeenCalledWith('org-1', 'user-1', null);
		expect(mocks.stripeUpdate).not.toHaveBeenCalled();
	});
});

function member(userId: string) {
	return { orgId: 'org-1', userId, role: 'user' as const };
}

function projectMember(userId: string) {
	return { projectId: 'project-1', userId, role: 'user' as const };
}

function updateSeatCandidate(userId: string, role: string): void {
	mocks.seatCandidates = mocks.seatCandidates.filter(({ id }) => id !== userId);
	if (role !== 'viewer') {
		mocks.seatCandidates.push({ id: userId });
	}
}
