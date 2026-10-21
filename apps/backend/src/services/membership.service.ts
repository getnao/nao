import type { UserRole } from '@nao/shared/types';
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import * as orgQueries from '../queries/organization.queries';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
import type { OrgRole } from '../types/organization';
import { HandlerError } from '../utils/error';
import { cleanupContextWorktree } from './context-explorer-git.service';

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
	if (existing?.role === 'admin' && role !== 'admin' && (await orgQueries.countOrgAdmins(orgId)) <= 1) {
		throw new HandlerError('BAD_REQUEST', 'The organization must have at least one admin.');
	}
	if (existing) {
		await orgQueries.updateOrgMemberRole(orgId, userId, role);
		if (existing.role === 'admin' && role !== 'admin') {
			await cleanupLostOrgContextAccess(orgId, userId);
		}
	} else {
		await orgQueries.addOrgMember({ orgId, userId, role });
	}
	return { userId, role };
}

/**
 * Removes an organization membership, refusing to leave the organization without an admin.
 *
 * The admin guard is part of the DELETE: a count-then-delete would let two concurrent removals both
 * pass while the organization has two admins and then remove both. Sessions are deleted in the same
 * transaction, so a failed removal cannot sign the member out and a removed member cannot keep a
 * live session.
 */
export async function removeOrganizationMember(
	orgId: string,
	userId: string,
	options: { ignoreMissing?: boolean; deleteSessions?: boolean } = {},
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

		if (dbConfig.dialect === Dialect.Postgres) {
			return (async () => {
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
		await projectQueries.addProjectMember({ projectId, userId, role });
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
