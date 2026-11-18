import { and, eq, inArray, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import { activeUserGroupCondition } from '../queries/active-user-group.queries';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
import { withKeyedLock } from '../utils/keyed-lock';
import { isOpenProject } from '../utils/open-projects';
import { chunk } from '../utils/utils';
import { withUserGroupConfigLock } from './user-group-config-lock.service';

const EMAIL_LOOKUP_BATCH_SIZE = 500;

export async function listUsersEligibleForUserGroupConfig(
	projectId: string,
	normalizedEmails: string[],
): Promise<Array<{ id: string; email: string }>> {
	const desiredEmails = [...new Set(normalizedEmails)];
	if (desiredEmails.length === 0) {
		return [];
	}
	const desiredEmailSet = new Set(desiredEmails);
	const projectUsers = (await projectQueries.listUsersWithProjectAccessDetails(projectId)).filter((user) =>
		desiredEmailSet.has(user.email.trim().toLowerCase()),
	);
	if (!isOpenProject(projectId)) {
		return projectUsers;
	}
	const matchingUsers: Array<{ id: string; email: string }> = [];
	for (const emails of chunk(desiredEmails, EMAIL_LOOKUP_BATCH_SIZE)) {
		matchingUsers.push(
			...(await db
				.select({ id: s.user.id, email: s.user.email })
				.from(s.user)
				.where(inArray(sql<string>`lower(trim(${s.user.email}))`, emails))
				.execute()),
		);
	}
	return [...new Map([...projectUsers, ...matchingUsers].map((user) => [user.id, user])).values()];
}

export async function reconcileUserGroupConfigMembershipsForUser(userId: string): Promise<void> {
	const user = await userQueries.getUser({ id: userId });
	if (!user) {
		return;
	}
	const normalizedEmail = user.email.trim().toLowerCase();
	await withKeyedLock(`user-group-config-membership:${normalizedEmail}`, async () => {
		const [initialAssignments, initialMatchingUsers] = await Promise.all([
			listAssignments(normalizedEmail),
			listMatchingUsers(normalizedEmail),
		]);
		const existingProjectIds = await listConfigMembershipProjectIds(
			initialMatchingUsers.map((candidate) => candidate.id),
		);
		const projectIds = [
			...new Set([...initialAssignments.map((assignment) => assignment.projectId), ...existingProjectIds]),
		].sort();
		await withProjectLocks(projectIds, async () => {
			const [assignments, matchingUsers] = await Promise.all([
				listAssignments(normalizedEmail),
				listMatchingUsers(normalizedEmail),
			]);
			const affectedGroupIds = await listProjectGroupIds(projectIds);
			const desiredGroupsByUser = new Map<string, string[]>();
			for (const assignment of assignments) {
				const projectUsers = [];
				for (const candidate of matchingUsers) {
					if (await projectQueries.getUserRoleInProject(assignment.projectId, candidate.id)) {
						projectUsers.push(candidate);
					}
				}
				if (projectUsers.length === 1) {
					const matched = projectUsers[0]!;
					desiredGroupsByUser.set(matched.id, [
						...(desiredGroupsByUser.get(matched.id) ?? []),
						assignment.groupId,
					]);
				}
			}
			const affectedUserIds = new Set([userId, ...matchingUsers.map((candidate) => candidate.id)]);
			for (const affectedUserId of affectedUserIds) {
				await replaceConfigMemberships(
					affectedUserId,
					desiredGroupsByUser.get(affectedUserId) ?? [],
					affectedGroupIds,
				);
			}
		});
	});
}

function withProjectLocks<T>(projectIds: string[], operation: () => Promise<T>): Promise<T> {
	const [projectId, ...remainingProjectIds] = projectIds;
	if (!projectId) {
		return operation();
	}
	return withUserGroupConfigLock(projectId, async () => {
		return withProjectLocks(remainingProjectIds, operation);
	});
}

async function listConfigMembershipProjectIds(userIds: string[]): Promise<string[]> {
	if (userIds.length === 0) {
		return [];
	}
	const rows = await db
		.select({ projectId: s.userGroup.projectId })
		.from(s.userGroupMember)
		.innerJoin(s.userGroup, eq(s.userGroup.id, s.userGroupMember.groupId))
		.innerJoin(s.project, eq(s.project.id, s.userGroup.projectId))
		.where(
			and(
				inArray(s.userGroupMember.userId, userIds),
				eq(s.userGroupMember.provider, 'config'),
				eq(s.userGroupMember.active, true),
				eq(s.project.userGroupManagementMode, 'code'),
			),
		)
		.execute();
	return [...new Set(rows.map((row) => row.projectId))];
}

async function listProjectGroupIds(projectIds: string[]): Promise<string[]> {
	if (projectIds.length === 0) {
		return [];
	}
	return (
		await db
			.select({ id: s.userGroup.id })
			.from(s.userGroup)
			.where(inArray(s.userGroup.projectId, projectIds))
			.execute()
	).map((group) => group.id);
}

async function listAssignments(normalizedEmail: string): Promise<Array<{ groupId: string; projectId: string }>> {
	return db
		.select({
			groupId: s.userGroupConfigMember.groupId,
			projectId: s.userGroup.projectId,
		})
		.from(s.userGroupConfigMember)
		.innerJoin(s.userGroup, eq(s.userGroup.id, s.userGroupConfigMember.groupId))
		.innerJoin(s.project, eq(s.project.id, s.userGroup.projectId))
		.where(
			and(
				eq(s.userGroupConfigMember.normalizedEmail, normalizedEmail),
				eq(s.userGroupConfigMember.active, true),
				eq(s.project.userGroupManagementMode, 'code'),
				activeUserGroupCondition,
			),
		)
		.execute();
}

async function listMatchingUsers(normalizedEmail: string): Promise<Array<{ id: string }>> {
	return db
		.select({ id: s.user.id })
		.from(s.user)
		.where(sql`lower(trim(${s.user.email})) = ${normalizedEmail}`)
		.execute();
}

async function replaceConfigMemberships(
	userId: string,
	desiredGroupIds: string[],
	affectedGroupIds: string[],
): Promise<void> {
	if (affectedGroupIds.length === 0) {
		return;
	}
	const now = new Date();
	if (dbConfig.dialect === Dialect.Sqlite) {
		db.transaction(
			(transaction) => {
				transaction
					.update(s.userGroupMember)
					.set({ active: false })
					.where(
						and(
							eq(s.userGroupMember.userId, userId),
							eq(s.userGroupMember.provider, 'config'),
							inArray(s.userGroupMember.groupId, affectedGroupIds),
						),
					)
					.run();
				for (const groupId of desiredGroupIds) {
					transaction
						.insert(s.userGroupMember)
						.values({ groupId, userId, provider: 'config', active: true })
						.onConflictDoUpdate({
							target: [s.userGroupMember.groupId, s.userGroupMember.userId, s.userGroupMember.provider],
							set: { active: true, createdAt: now },
						})
						.run();
				}
			},
			{ behavior: 'immediate' },
		);
		return;
	}
	await db.transaction(async (transaction) => {
		await transaction
			.update(s.userGroupMember)
			.set({ active: false })
			.where(
				and(
					eq(s.userGroupMember.userId, userId),
					eq(s.userGroupMember.provider, 'config'),
					inArray(s.userGroupMember.groupId, affectedGroupIds),
				),
			)
			.execute();
		if (desiredGroupIds.length > 0) {
			await transaction
				.insert(s.userGroupMember)
				.values(
					desiredGroupIds.map((groupId) => ({ groupId, userId, provider: 'config' as const, active: true })),
				)
				.onConflictDoUpdate({
					target: [s.userGroupMember.groupId, s.userGroupMember.userId, s.userGroupMember.provider],
					set: { active: true, createdAt: now },
				})
				.execute();
		}
	});
}
