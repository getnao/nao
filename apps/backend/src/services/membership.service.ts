import type { UserRole } from '@nao/shared/types';
import { and, count, eq, inArray, ne, or, sql } from 'drizzle-orm';

import type { DBOrgMember, DBProjectMember, NewOrgMember, NewProjectMember } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db, type DBExecutor, type Lockable } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import * as orgQueries from '../queries/organization.queries';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
import * as userGroupQueries from '../queries/user-group.queries';
import type { OrgRole } from '../types/organization';
import { HandlerError } from '../utils/error';
import { cleanupContextWorktree } from './context-explorer-git.service';
import { recordOrganizationJoinCandidate, recordProjectJoinCandidate } from './credit-grant.service';
import { addProjectMemberWithUserGroups } from './project-user-group-membership.service';

export async function addOrganizationMember(member: NewOrgMember): Promise<DBOrgMember> {
	await Promise.all([requireOrganization(member.orgId), requireUser(member.userId)]);
	return createOrganizationMember(member);
}

export async function addOrganizationMemberIfMissing(member: NewOrgMember): Promise<void> {
	await Promise.all([requireOrganization(member.orgId), requireUser(member.userId)]);
	await persistOrganizationMember(member, () => orgQueries.addOrgMemberIfMissing(member));
}

/**
 * The membership and its group assignments land together: a group deleted between validation and
 * insert must not leave the user a member of an organization they were never fully invited to.
 */
export async function addOrganizationMemberWithGroups(member: NewOrgMember, groupIds: string[]): Promise<void> {
	await Promise.all([requireOrganization(member.orgId), requireUser(member.userId)]);
	const uniqueGroupIds = [...new Set(groupIds)];
	const groupMemberships = uniqueGroupIds.map((groupId) => ({
		groupId,
		userId: member.userId,
		provider: 'manual' as const,
	}));

	if (dbConfig.dialect === Dialect.Sqlite) {
		db.transaction((transaction) => {
			transaction.insert(s.orgMember).values(member).run();
			if (groupMemberships.length) {
				transaction.insert(s.userGroupMember).values(groupMemberships).onConflictDoNothing().run();
			}
		});
		return;
	}

	await db.transaction(async (transaction) => {
		await orgQueries.addOrgMember(member, transaction);
		await userGroupQueries.addUserGroupMemberships(uniqueGroupIds, member.userId, transaction);
	});
}

export async function addProjectMember(member: NewProjectMember, groupIds: string[] = []): Promise<DBProjectMember> {
	await Promise.all([requireProject(member.projectId), requireUser(member.userId)]);
	return createProjectMember(member, groupIds);
}

export async function putOrganizationMember(
	orgId: string,
	userId: string,
	role: OrgRole,
	options: { addIfMissing?: boolean } = {},
) {
	await requireOrganization(orgId);
	const existing = await orgQueries.getOrgMember(orgId, userId);
	if (!existing && options.addIfMissing === false) {
		return { userId, role };
	}
	await requireUser(userId);
	const demotesAdmin = existing?.role === 'admin' && role !== 'admin';
	if (demotesAdmin) {
		await demoteOrganizationAdmin(orgId, userId, role);
	} else if (existing) {
		await orgQueries.updateOrgMemberRole(orgId, userId, role);
	} else {
		await createOrganizationMember({ orgId, userId, role });
	}
	if (demotesAdmin) {
		await cleanupLostOrgContextAccess(orgId, userId);
	}
	return { userId, role };
}

export const FOREIGN_ORGANIZATION_PURGE_MESSAGE =
	'This user belongs to another organization: revoke without purge to keep the account.';

/**
 * Removes an organization membership, refusing to leave the organization without an admin.
 *
 * The admin guard is folded into the DELETE, and on PostgreSQL the decision is serialised by a lock
 * on the organization row taken before the guard runs: a bare count-then-delete lets two concurrent
 * removals both see the other admin and then delete both. Sessions are deleted in the same
 * transaction, so a failed removal cannot sign the member out and a removed member cannot keep a
 * live session.
 *
 * `purgeAccount` takes the account itself in that same transaction, and the confinement guard rides
 * on the user DELETE: whoever added the user to a second organization waits on the user row (its
 * foreign key needs `user`), so a membership added after the caller's check still keeps the account.
 */
export async function removeOrganizationMember(
	orgId: string,
	userId: string,
	options: { ignoreMissing?: boolean; deleteSessions?: boolean; purgeAccount?: boolean } = {},
): Promise<void> {
	await requireOrganization(orgId);

	const removed = await db.transaction((tx) => {
		const guard = and(
			eq(s.orgMember.orgId, orgId),
			eq(s.orgMember.userId, userId),
			or(
				ne(s.orgMember.role, 'admin'),
				sql`(select count(*) from ${s.orgMember} where org_id = ${orgId} and role = 'admin') > 1`,
			),
		);
		const purgeGuard = () => and(eq(s.user.id, userId), userQueries.confinedToOrganization(userId, orgId));

		if (dbConfig.dialect === Dialect.Postgres) {
			return (async () => {
				await lockOrganizationRow(tx, orgId);
				const [row] = await tx.delete(s.orgMember).where(guard).returning().execute();
				if (!row) {
					return false;
				}
				// Project roles are explicit grants, so they go with the organization membership in the
				// same transaction: a half-revoked user must not keep access through `project_member`.
				await tx
					.delete(s.projectMember)
					.where(
						and(
							eq(s.projectMember.userId, userId),
							inArray(
								s.projectMember.projectId,
								tx.select({ id: s.project.id }).from(s.project).where(eq(s.project.orgId, orgId)),
							),
						),
					)
					.execute();
				if (options.deleteSessions) {
					await tx.delete(s.session).where(eq(s.session.userId, userId)).execute();
				}
				if (options.purgeAccount) {
					await lockUserRow(tx, userId);
					const [purged] = await tx.delete(s.user).where(purgeGuard()).returning({ id: s.user.id }).execute();
					if (!purged) {
						throw new HandlerError('CONFLICT', FOREIGN_ORGANIZATION_PURGE_MESSAGE);
					}
				}
				return true;
			})();
		}

		const row = tx.delete(s.orgMember).where(guard).returning().get();
		if (!row) {
			return false;
		}
		tx.delete(s.projectMember)
			.where(
				and(
					eq(s.projectMember.userId, userId),
					inArray(
						s.projectMember.projectId,
						tx.select({ id: s.project.id }).from(s.project).where(eq(s.project.orgId, orgId)),
					),
				),
			)
			.run();
		if (options.deleteSessions) {
			tx.delete(s.session).where(eq(s.session.userId, userId)).run();
		}
		if (options.purgeAccount) {
			// SQLite has one writer, so the guard in this DELETE is enough: no membership can appear
			// between the check and the delete.
			const purged = tx.delete(s.user).where(purgeGuard()).returning({ id: s.user.id }).get();
			if (!purged) {
				throw new HandlerError('CONFLICT', FOREIGN_ORGANIZATION_PURGE_MESSAGE);
			}
		}
		return true;
	});

	if (!removed) {
		const membership = await orgQueries.getOrgMember(orgId, userId);
		if (membership) {
			throw new HandlerError('BAD_REQUEST', 'Cannot remove the last admin from the organization.');
		}
		if (!options.ignoreMissing) {
			throw new HandlerError('NOT_FOUND', 'Organization membership not found');
		}
		// The membership was already gone; lingering project rows still get cleaned up below.
		await orgQueries.removeOrgMemberFromProjects(orgId, userId);
	}

	await cleanupLostOrgContextAccess(orgId, userId);
}

/**
 * Deletes an account only while every membership it has still belongs to this organization.
 *
 * Folding the confinement check into the DELETE keeps a membership added after the caller's check from
 * losing its account; on PostgreSQL the user-row lock taken first makes the check wait for a concurrent
 * insert instead of reading a snapshot that predates it.
 */
export async function deleteUserIfConfinedToOrganization(userId: string, orgId: string): Promise<boolean> {
	const guard = and(eq(s.user.id, userId), userQueries.confinedToOrganization(userId, orgId));

	return db.transaction((tx) => {
		if (dbConfig.dialect === Dialect.Postgres) {
			return (async () => {
				await lockUserRow(tx, userId);
				const [deleted] = await tx.delete(s.user).where(guard).returning({ id: s.user.id }).execute();
				return !!deleted;
			})();
		}

		return !!tx.delete(s.user).where(guard).returning({ id: s.user.id }).get();
	});
}

export async function putProjectMember(projectId: string, userId: string, role: UserRole) {
	const [project] = await Promise.all([requireProject(projectId), requireUser(userId)]);
	if (!project.orgId || !(await orgQueries.getOrgMember(project.orgId, userId))) {
		throw new HandlerError('BAD_REQUEST', "User is not a member of the project's organization");
	}
	const existing = await projectQueries.getProjectMember(projectId, userId);
	if (
		existing?.role === 'admin' &&
		role !== 'admin' &&
		!(await projectQueries.checkProjectHasMoreThanOneAdmin(projectId))
	) {
		throw new HandlerError('BAD_REQUEST', 'The project must have at least one admin user.');
	}
	const previousRole = existing?.role ?? (await projectQueries.getUserRoleInProject(projectId, userId));
	if (existing) {
		await projectQueries.updateProjectMemberRole(projectId, userId, role);
	} else {
		await createProjectMember({ projectId, userId, role });
	}
	if (project.path && isContextRole(previousRole) && !isContextRole(role)) {
		await cleanupContextWorktree(projectId, project.path, userId);
	}
	return { userId, role };
}

export async function removeProjectMember(projectId: string, userId: string): Promise<void> {
	const project = await requireProject(projectId);
	const role = await projectQueries.getUserRoleInProject(projectId, userId);
	if (role === 'admin') {
		throw new HandlerError('CONFLICT', 'Cannot remove an admin from the project.');
	}
	await projectQueries.removeProjectMember(projectId, userId);
	const remainingRole = await projectQueries.getUserRoleInProject(projectId, userId);
	if (project.path && !isContextRole(remainingRole)) {
		await cleanupContextWorktree(projectId, project.path, userId);
	}
}

/** Demotes an admin only while another one remains, under the same organization-row lock as a removal. */
async function demoteOrganizationAdmin(orgId: string, userId: string, role: OrgRole): Promise<void> {
	const demote = (executor: DBExecutor) =>
		executor
			.update(s.orgMember)
			.set({ role })
			.where(and(eq(s.orgMember.orgId, orgId), eq(s.orgMember.userId, userId)))
			.execute();
	const assertAdminRemains = (admins: number): void => {
		if (admins <= 1) {
			throw new HandlerError('BAD_REQUEST', 'The organization must have at least one admin.');
		}
	};

	if (dbConfig.dialect !== Dialect.Postgres) {
		assertAdminRemains(await orgQueries.countOrgAdmins(orgId));
		await demote(db);
		return;
	}

	await db.transaction(async (tx) => {
		await lockOrganizationRow(tx, orgId);
		const [row] = await tx
			.select({ count: count() })
			.from(s.orgMember)
			.where(and(eq(s.orgMember.orgId, orgId), eq(s.orgMember.role, 'admin')))
			.execute();
		assertAdminRemains(row?.count ?? 0);
		await demote(tx);
	});
}

async function lockOrganizationRow(tx: DBExecutor, orgId: string): Promise<void> {
	await lockForUpdate(
		tx.select({ id: s.organization.id }).from(s.organization).where(eq(s.organization.id, orgId)),
	).execute();
}

/** Serialises the purge against a concurrent membership insert, whose foreign key holds a KEY SHARE on this row. */
async function lockUserRow(tx: DBExecutor, userId: string): Promise<void> {
	await lockForUpdate(tx.select({ id: s.user.id }).from(s.user).where(eq(s.user.id, userId))).execute();
}

const lockForUpdate = <Query extends { execute(): unknown }>(query: Query): Query =>
	dbConfig.dialect === Dialect.Postgres ? (query as Query & Lockable<Query>).for('update') : query;

async function createOrganizationMember(member: NewOrgMember): Promise<DBOrgMember> {
	return persistOrganizationMember(member, () => orgQueries.addOrgMember(member));
}

async function persistOrganizationMember<T>(member: NewOrgMember, persist: () => Promise<T>): Promise<T> {
	const created = await persist();
	await recordOrganizationJoinCandidate(member.orgId, member.userId);
	return created;
}

async function createProjectMember(member: NewProjectMember, groupIds: string[] = []): Promise<DBProjectMember> {
	const created = groupIds.length
		? await addProjectMemberWithUserGroups(member, groupIds)
		: await projectQueries.addProjectMember(member);
	await recordProjectJoinCandidate(member.projectId, member.userId);
	return created;
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
