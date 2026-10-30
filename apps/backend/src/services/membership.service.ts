import type { UserRole } from '@nao/shared/types';

import type { NewOrgMember, NewProjectMember } from '../db/abstractSchema';
import { isCloudFreeTierEnabled } from '../env';
import * as orgQueries from '../queries/organization.queries';
import {
	listOrganizationSeatStates,
	setOrganizationSeatSelection,
	syncOrganizationSeatState,
} from '../queries/organization-seat-state.queries';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
import { TEAM_MIN_SEATS } from '../types/billing';
import type { OrgRole } from '../types/organization';
import { HandlerError } from '../utils/error';
import { withKeyedLock } from '../utils/keyed-lock';
import { getOrganizationCloudEntitlement } from './cloud-billing-access.service';
import { cleanupContextWorktree } from './context-explorer-git.service';
import { recordOrganizationJoinCandidate, recordProjectJoinCandidate } from './credit-grant.service';
import { addProjectMemberWithUserGroups } from './project-user-group-membership.service';

export type NonViewerRole = Exclude<UserRole, 'viewer'>;

export type SeatActivationOutcome =
	| { status: 'activated'; role: NonViewerRole; usedExistingSeat: boolean }
	| { status: 'viewer_fallback'; role: 'viewer'; reason: 'capacity_full' }
	| { status: 'purchase_required'; requestedRole: NonViewerRole; targetSeatQuantity: number }
	| { status: 'promotion_rejected'; role: 'viewer'; reason: 'capacity_full' };

export type MembershipMutationResult = {
	userId: string;
	role: UserRole | null;
	outcome: SeatActivationOutcome | null;
};

type SeatActivationOptions = {
	capacityBehavior?: 'viewer_fallback' | 'purchase_required';
};

type SeatMutationResult = MembershipMutationResult & {
	previousRole: UserRole | null;
};

export async function addOrganizationMember(
	member: NewOrgMember,
	options: SeatActivationOptions = {},
): Promise<MembershipMutationResult> {
	await Promise.all([requireOrganization(member.orgId), requireUser(member.userId)]);
	const result = await withOrganizationSeatLock(member.orgId, () =>
		mutateOrganizationMembership(member, { ...options, addIfMissing: true }),
	);
	return toMembershipMutationResult(result);
}

export async function addOrganizationMemberIfMissing(member: NewOrgMember): Promise<MembershipMutationResult> {
	await Promise.all([requireOrganization(member.orgId), requireUser(member.userId)]);
	const result = await withOrganizationSeatLock(member.orgId, () =>
		mutateOrganizationMembership(member, { addIfMissing: true, preserveExisting: true }),
	);
	return toMembershipMutationResult(result);
}

export async function addProjectMember(
	member: NewProjectMember,
	groupIds: string[] = [],
): Promise<MembershipMutationResult> {
	const [project] = await Promise.all([requireProject(member.projectId), requireUser(member.userId)]);
	if (!project.orgId) {
		throw new HandlerError('BAD_REQUEST', "Project doesn't belong to an organization");
	}
	const result = await withOrganizationSeatLock(project.orgId, () =>
		mutateProjectMembership(project.orgId!, member.projectId, member.userId, member.role, {
			addIfMissing: true,
			groupIds,
		}),
	);
	return toMembershipMutationResult(result);
}

export async function putOrganizationMember(
	orgId: string,
	userId: string,
	role: OrgRole,
	options: SeatActivationOptions & { addIfMissing?: boolean } = {},
): Promise<MembershipMutationResult> {
	return withOrganizationSeatLock(orgId, () => putOrganizationMemberUnderBillingLock(orgId, userId, role, options));
}

export async function putOrganizationMemberUnderBillingLock(
	orgId: string,
	userId: string,
	role: OrgRole,
	options: SeatActivationOptions & { addIfMissing?: boolean } = {},
): Promise<MembershipMutationResult> {
	await Promise.all([requireOrganization(orgId), requireUser(userId)]);
	const result = await mutateOrganizationMembership(
		{ orgId, userId, role },
		{ ...options, addIfMissing: options.addIfMissing !== false },
	);
	if (result.previousRole === 'admin' && result.role !== 'admin') {
		await cleanupLostOrgContextAccess(orgId, userId);
	}
	return toMembershipMutationResult(result);
}

export async function removeOrganizationMember(
	orgId: string,
	userId: string,
	options: { ignoreMissing?: boolean } = {},
): Promise<void> {
	await requireOrganization(orgId);
	await withOrganizationSeatLock(orgId, async () => {
		const membership = await orgQueries.getOrgMember(orgId, userId);
		if (!membership && !options.ignoreMissing) {
			throw new HandlerError('NOT_FOUND', 'Organization membership not found');
		}
		if (membership?.role === 'admin' && (await orgQueries.countOrgAdmins(orgId)) <= 1) {
			throw new HandlerError('BAD_REQUEST', 'Cannot remove the last admin from the organization.');
		}
		await orgQueries.removeOrgMemberFromProjects(orgId, userId);
		await orgQueries.removeOrgMember(orgId, userId);
		await clearSeatSelectionAndSync(orgId, userId);
	});
	await cleanupLostOrgContextAccess(orgId, userId);
}

export async function putProjectMember(
	projectId: string,
	userId: string,
	role: UserRole,
): Promise<MembershipMutationResult> {
	const [project] = await Promise.all([requireProject(projectId), requireUser(userId)]);
	if (!project.orgId) {
		throw new HandlerError('BAD_REQUEST', "Project doesn't belong to an organization");
	}
	const result = await withOrganizationSeatLock(project.orgId, () =>
		mutateProjectMembership(project.orgId!, projectId, userId, role, { addIfMissing: true }),
	);
	if (project.path && isContextRole(result.previousRole) && !isContextRole(result.role)) {
		await cleanupContextWorktree(projectId, project.path, userId);
	}
	return toMembershipMutationResult(result);
}

export async function removeProjectMember(projectId: string, userId: string): Promise<void> {
	const project = await requireProject(projectId);
	if (!project.orgId) {
		throw new HandlerError('BAD_REQUEST', "Project doesn't belong to an organization");
	}
	await withOrganizationSeatLock(project.orgId, async () => {
		const role = await projectQueries.getUserRoleInProject(projectId, userId);
		if (role === 'admin') {
			throw new HandlerError('CONFLICT', 'Cannot remove an admin from the project.');
		}
		await projectQueries.removeProjectMember(projectId, userId);
		await clearSeatSelectionAndSync(project.orgId!, userId);
	});
	const remainingRole = await projectQueries.getUserRoleInProject(projectId, userId);
	if (project.path && !isContextRole(remainingRole)) {
		await cleanupContextWorktree(projectId, project.path, userId);
	}
}

async function mutateOrganizationMembership(
	member: NewOrgMember,
	options: SeatActivationOptions & { addIfMissing: boolean; preserveExisting?: boolean },
): Promise<SeatMutationResult> {
	return mutateMembership({
		orgId: member.orgId,
		userId: member.userId,
		requestedRole: member.role,
		capacityBehavior: options.capacityBehavior,
		readRole: async () => (await orgQueries.getOrgMember(member.orgId, member.userId))?.role ?? null,
		persistRole: async (role, existingRole) => {
			if (existingRole) {
				if (!options.preserveExisting) {
					await orgQueries.updateOrgMemberRole(member.orgId, member.userId, role as OrgRole);
				}
			} else if (options.addIfMissing) {
				const nextMember = { ...member, role: role as OrgRole };
				await persistOrganizationMember(nextMember, async () => {
					if (options.preserveExisting) {
						await orgQueries.addOrgMemberIfMissing(nextMember);
					} else {
						await orgQueries.addOrgMember(nextMember);
					}
				});
			}
		},
		preserveExisting: options.preserveExisting,
		addIfMissing: options.addIfMissing,
		assertRoleChangeAllowed: async (existingRole, role) => {
			if (existingRole === 'admin' && role !== 'admin' && (await orgQueries.countOrgAdmins(member.orgId)) <= 1) {
				throw new HandlerError('BAD_REQUEST', 'The organization must have at least one admin.');
			}
		},
	});
}

async function persistOrganizationMember<T>(member: NewOrgMember, persist: () => Promise<T>): Promise<T> {
	const created = await persist();
	await recordOrganizationJoinCandidate(member.orgId, member.userId);
	return created;
}

async function mutateProjectMembership(
	orgId: string,
	projectId: string,
	userId: string,
	role: UserRole,
	options: { addIfMissing: boolean; groupIds?: string[] },
): Promise<SeatMutationResult> {
	return mutateMembership({
		orgId,
		userId,
		requestedRole: role,
		readRole: async () => (await projectQueries.getProjectMember(projectId, userId))?.role ?? null,
		readPreviousRole: () => projectQueries.getUserRoleInProject(projectId, userId),
		persistRole: async (nextRole, existingRole) => {
			if (existingRole) {
				await projectQueries.updateProjectMemberRole(projectId, userId, nextRole);
			} else if (options.addIfMissing) {
				await createProjectMember({ projectId, userId, role: nextRole }, options.groupIds);
			}
		},
		addIfMissing: options.addIfMissing,
		assertRoleChangeAllowed: async (existingRole, nextRole) => {
			if (
				existingRole === 'admin' &&
				nextRole !== 'admin' &&
				!(await projectQueries.checkProjectHasMoreThanOneAdmin(projectId))
			) {
				throw new HandlerError('BAD_REQUEST', 'The project must have at least one admin user.');
			}
		},
	});
}

async function mutateMembership(input: {
	orgId: string;
	userId: string;
	requestedRole: UserRole;
	capacityBehavior?: SeatActivationOptions['capacityBehavior'];
	readRole: () => Promise<UserRole | null>;
	readPreviousRole?: () => Promise<UserRole | null>;
	persistRole: (role: UserRole, existingRole: UserRole | null) => Promise<void>;
	preserveExisting?: boolean;
	addIfMissing: boolean;
	assertRoleChangeAllowed: (existingRole: UserRole | null, role: UserRole) => Promise<void>;
}): Promise<SeatMutationResult> {
	const existingRole = await input.readRole();
	const previousRole = input.readPreviousRole ? await input.readPreviousRole() : existingRole;
	if (existingRole && input.preserveExisting) {
		return { userId: input.userId, role: existingRole, outcome: null, previousRole };
	}
	if (!existingRole && !input.addIfMissing) {
		return { userId: input.userId, role: null, outcome: null, previousRole };
	}
	await input.assertRoleChangeAllowed(existingRole, input.requestedRole);

	if (input.requestedRole === 'viewer') {
		await input.persistRole('viewer', existingRole);
		await clearSeatSelectionAndSync(input.orgId, input.userId);
		return { userId: input.userId, role: 'viewer', outcome: null, previousRole };
	}

	const requestedRole = input.requestedRole;
	const [entitlement, candidates] = await Promise.all([
		getOrganizationCloudEntitlement(input.orgId),
		orgQueries.listOrgSeatCandidates(input.orgId),
	]);
	if (!entitlement) {
		throw new HandlerError('NOT_FOUND', 'Organization not found');
	}
	const alreadySeatUser = candidates.some(({ id }) => id === input.userId);
	const canActivate =
		!isCloudFreeTierEnabled() ||
		alreadySeatUser ||
		entitlement.seatLimit === null ||
		(entitlement.availableSeats !== null && entitlement.availableSeats > 0);
	if (canActivate) {
		await input.persistRole(requestedRole, existingRole);
		await syncMembershipSeatState(input.orgId);
		return {
			userId: input.userId,
			role: requestedRole,
			outcome: {
				status: 'activated',
				role: requestedRole,
				usedExistingSeat: alreadySeatUser || entitlement.seatLimit !== null,
			},
			previousRole,
		};
	}

	if (input.capacityBehavior === 'purchase_required') {
		return {
			userId: input.userId,
			role: existingRole,
			outcome: {
				status: 'purchase_required',
				requestedRole,
				targetSeatQuantity: Math.max(
					TEAM_MIN_SEATS,
					entitlement.seatUserCount + 1,
					(entitlement.seatQuantity ?? 0) + 1,
				),
			},
			previousRole,
		};
	}

	if (existingRole === 'viewer') {
		await setOrganizationSeatSelection(input.orgId, input.userId, null);
		await syncMembershipSeatState(input.orgId);
		return {
			userId: input.userId,
			role: 'viewer',
			outcome: { status: 'promotion_rejected', role: 'viewer', reason: 'capacity_full' },
			previousRole,
		};
	}

	await input.persistRole('viewer', existingRole);
	await clearSeatSelectionAndSync(input.orgId, input.userId);
	return {
		userId: input.userId,
		role: 'viewer',
		outcome: { status: 'viewer_fallback', role: 'viewer', reason: 'capacity_full' },
		previousRole,
	};
}

async function createProjectMember(member: NewProjectMember, groupIds: string[] = []) {
	const created = groupIds.length
		? await addProjectMemberWithUserGroups(member, groupIds)
		: await projectQueries.addProjectMember(member);
	await recordProjectJoinCandidate(member.projectId, member.userId);
	return created;
}

async function clearSeatSelectionAndSync(orgId: string, userId: string): Promise<void> {
	if (!isCloudFreeTierEnabled()) {
		return;
	}
	await setOrganizationSeatSelection(orgId, userId, null);
	await syncMembershipSeatState(orgId);
}

async function syncMembershipSeatState(orgId: string): Promise<void> {
	if (!isCloudFreeTierEnabled()) {
		return;
	}
	const [entitlement, candidates, states] = await Promise.all([
		getOrganizationCloudEntitlement(orgId),
		orgQueries.listOrgSeatCandidates(orgId),
		listOrganizationSeatStates(orgId),
	]);
	if (!entitlement) {
		return;
	}
	const readOnlyIds =
		entitlement.tier === 'team' && entitlement.seatQuantity === null
			? new Set(candidates.map(({ id }) => id))
			: new Set(
					entitlement.overCapacity && entitlement.seatLimit !== null
						? candidates.slice(entitlement.seatLimit).map(({ id }) => id)
						: [],
				);
	const userIds = new Set([...readOnlyIds, ...states.map(({ userId }) => userId)]);
	const changedAt = new Date();
	await Promise.all(
		[...userIds].map((userId) =>
			syncOrganizationSeatState({
				orgId,
				userId,
				isReadOnly: readOnlyIds.has(userId),
				changedAt,
			}),
		),
	);
}

function withOrganizationSeatLock<T>(orgId: string, operation: () => Promise<T>): Promise<T> {
	return withKeyedLock(`cloud-seats:${orgId}`, operation);
}

function toMembershipMutationResult(result: SeatMutationResult): MembershipMutationResult {
	return { userId: result.userId, role: result.role, outcome: result.outcome };
}

async function cleanupLostOrgContextAccess(orgId: string, userId: string): Promise<void> {
	const projects = await orgQueries.listOrgProjectsForContextCleanup(orgId, userId);
	for (const project of projects) {
		if (project.path && !isContextRole(project.role)) {
			await cleanupContextWorktree(project.id, project.path, userId);
		}
	}
}

async function requireOrganization(orgId: string) {
	const organization = await orgQueries.getOrganizationById(orgId);
	if (!organization) {
		throw new HandlerError('NOT_FOUND', 'Organization not found');
	}
	return organization;
}

async function requireProject(projectId: string) {
	const project = await projectQueries.getProjectById(projectId);
	if (!project) {
		throw new HandlerError('NOT_FOUND', 'Project not found');
	}
	return project;
}

async function requireUser(userId: string) {
	const user = await userQueries.getUser({ id: userId });
	if (!user) {
		throw new HandlerError('NOT_FOUND', 'User not found');
	}
	return user;
}

function isContextRole(role: UserRole | null): boolean {
	return role === 'admin' || role === 'context_admin';
}
