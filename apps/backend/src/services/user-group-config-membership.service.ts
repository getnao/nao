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
		const [assignments, matchingUsers] = await Promise.all([
			listAssignments(normalizedEmail),
			listMatchingUsers(normalizedEmail),
		]);
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
			await replaceConfigMemberships(affectedUserId, desiredGroupsByUser.get(affectedUserId) ?? []);
		}
	});
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

async function replaceConfigMemberships(userId: string, desiredGroupIds: string[]): Promise<void> {
	const now = new Date();
	if (dbConfig.dialect === Dialect.Sqlite) {
		db.transaction(
			(transaction) => {
				transaction
					.update(s.userGroupMember)
					.set({ active: false })
					.where(and(eq(s.userGroupMember.userId, userId), eq(s.userGroupMember.provider, 'config')))
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
			.where(and(eq(s.userGroupMember.userId, userId), eq(s.userGroupMember.provider, 'config')))
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
