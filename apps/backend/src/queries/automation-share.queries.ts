import type { ShareRole } from '@nao/shared/types';
import { and, countDistinct, eq, inArray, isNull, notInArray } from 'drizzle-orm';

import s, { type DBAutomation } from '../db/abstractSchema';
import { db } from '../db/db';
import { listLockedUserGroupIdsOfMember } from './locked-user-groups';
import { getUserRoleInProject } from './project.queries';

export type AutomationRole = 'owner' | ShareRole;

export type AutomationShareEntry = { userId: string | null; groupId: string | null; role: ShareRole };

export type AutomationUserGrant = { id: string; name: string; email: string; role: ShareRole };

export type AutomationGroupGrant = { id: string; name: string; memberCount: number; role: ShareRole };

const ROLE_RANK: Record<AutomationRole, number> = { viewer: 0, editor: 1, owner: 2 };

export function hasAutomationRole(role: AutomationRole | undefined, minimumRole: AutomationRole): boolean {
	return role !== undefined && ROLE_RANK[role] >= ROLE_RANK[minimumRole];
}

/** What the user can do with each automation of the project; automations they cannot see are left out. */
export async function resolveAutomationRoles(
	projectId: string,
	automations: Pick<DBAutomation, 'id' | 'userId'>[],
	userId: string,
): Promise<Map<string, AutomationRole>> {
	const sharedIds = automations.filter((automation) => automation.userId !== userId).map(({ id }) => id);
	const [shares, groupIds, projectRole] = await Promise.all([
		listSharesOfAutomations(sharedIds),
		listActiveGroupIdsOfMember(userId),
		sharedIds.length > 0 ? getUserRoleInProject(projectId, userId) : null,
	]);
	const memberGroupIds = new Set(groupIds);
	const roles = new Map<string, AutomationRole>();
	for (const automation of automations) {
		const role =
			automation.userId === userId
				? 'owner'
				: resolveSharedRole(shares.get(automation.id) ?? [], userId, memberGroupIds);
		if (role) {
			roles.set(automation.id, role === 'editor' && projectRole === 'viewer' ? 'viewer' : role);
		}
	}
	return roles;
}

export async function listAutomationShares(automationId: string): Promise<AutomationShareEntry[]> {
	return (await listSharesOfAutomations([automationId])).get(automationId) ?? [];
}

export async function listAutomationUserGrants(automationId: string): Promise<AutomationUserGrant[]> {
	return db
		.select({ id: s.user.id, name: s.user.name, email: s.user.email, role: s.automationShare.role })
		.from(s.automationShare)
		.innerJoin(s.user, eq(s.user.id, s.automationShare.userId))
		.where(eq(s.automationShare.automationId, automationId))
		.orderBy(s.user.name)
		.execute();
}

export async function listAutomationGroupGrants(automationId: string): Promise<AutomationGroupGrant[]> {
	const rows = await db
		.select({
			id: s.userGroup.id,
			name: s.userGroup.name,
			role: s.automationShare.role,
			memberCount: countDistinct(s.userGroupMember.userId),
		})
		.from(s.automationShare)
		.innerJoin(s.userGroup, eq(s.userGroup.id, s.automationShare.groupId))
		.leftJoin(s.userGroupMember, eq(s.userGroupMember.groupId, s.userGroup.id))
		.where(eq(s.automationShare.automationId, automationId))
		.groupBy(s.userGroup.id, s.userGroup.name, s.automationShare.role)
		.orderBy(s.userGroup.name)
		.execute();
	return rows.map((row) => ({ ...row, memberCount: Number(row.memberCount) }));
}

export async function replaceAutomationShares(automationId: string, shares: AutomationShareEntry[]): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.delete(s.automationShare).where(eq(s.automationShare.automationId, automationId)).execute();
		if (shares.length > 0) {
			await tx
				.insert(s.automationShare)
				.values(shares.map((share) => ({ ...share, automationId })))
				.execute();
		}
	});
}

/** Automations of the given owners that are shared with the whole project. */
export async function listProjectWideSharedAutomationIds(projectId: string, ownerIds: string[]): Promise<string[]> {
	if (ownerIds.length === 0) {
		return [];
	}
	const rows = await db
		.selectDistinct({ id: s.automation.id })
		.from(s.automationShare)
		.innerJoin(s.automation, eq(s.automation.id, s.automationShare.automationId))
		.where(
			and(
				eq(s.automation.projectId, projectId),
				inArray(s.automation.userId, ownerIds),
				isNull(s.automationShare.userId),
				isNull(s.automationShare.groupId),
			),
		)
		.execute();
	return rows.map((row) => row.id);
}

export async function deleteAutomationShares(automationIds: string[]): Promise<void> {
	if (automationIds.length > 0) {
		await db.delete(s.automationShare).where(inArray(s.automationShare.automationId, automationIds)).execute();
	}
}

/** A role given to the person wins; otherwise the best role of their groups or of the whole project applies. */
function resolveSharedRole(
	shares: AutomationShareEntry[],
	userId: string,
	groupIds: Set<string>,
): ShareRole | undefined {
	const personal = shares.find((share) => share.userId === userId);
	if (personal) {
		return personal.role;
	}
	const inherited = shares.filter(
		(share) => share.userId === null && (share.groupId === null || groupIds.has(share.groupId)),
	);
	if (inherited.length === 0) {
		return undefined;
	}
	return inherited.some((share) => share.role === 'editor') ? 'editor' : 'viewer';
}

async function listSharesOfAutomations(automationIds: string[]): Promise<Map<string, AutomationShareEntry[]>> {
	if (automationIds.length === 0) {
		return new Map();
	}
	const rows = await db
		.select({
			automationId: s.automationShare.automationId,
			userId: s.automationShare.userId,
			groupId: s.automationShare.groupId,
			role: s.automationShare.role,
		})
		.from(s.automationShare)
		.where(inArray(s.automationShare.automationId, automationIds))
		.execute();
	const sharesByAutomation = new Map<string, AutomationShareEntry[]>();
	for (const { automationId, ...share } of rows) {
		sharesByAutomation.set(automationId, [...(sharesByAutomation.get(automationId) ?? []), share]);
	}
	return sharesByAutomation;
}

async function listActiveGroupIdsOfMember(userId: string): Promise<string[]> {
	const lockedGroupIds = await listLockedUserGroupIdsOfMember(userId);
	const rows = await db
		.selectDistinct({ groupId: s.userGroupMember.groupId })
		.from(s.userGroupMember)
		.where(
			and(
				eq(s.userGroupMember.userId, userId),
				lockedGroupIds.length > 0 ? notInArray(s.userGroupMember.groupId, lockedGroupIds) : undefined,
			),
		)
		.execute();
	return rows.map((row) => row.groupId);
}
