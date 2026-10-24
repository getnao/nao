import type { UserRole } from '@nao/shared/types';

import * as orgQueries from '../queries/organization.queries';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
import * as userGroupQueries from '../queries/user-group.queries';
import type { OrgRole } from '../types/organization';
import { HandlerError } from '../utils/error';
import { withKeyedLock } from '../utils/keyed-lock';
import { cleanupContextWorktree } from './context-explorer-git.service';

export async function putOrganizationMember(
	orgId: string,
	userId: string,
	role: OrgRole,
	options: { addIfMissing?: boolean } = {},
) {
	await requireOrganization(orgId);
	const lostAdmin = await withKeyedLock(orgMembersLockKey(orgId), async () => {
		const existing = await orgQueries.getOrgMember(orgId, userId);
		if (!existing && options.addIfMissing === false) {
			return false;
		}
		await requireUser(userId);
		const isDemotingAdmin = existing?.role === 'admin' && role !== 'admin';
		if (isDemotingAdmin && (await orgQueries.countOrgAdmins(orgId)) <= 1) {
			throw new HandlerError('BAD_REQUEST', 'The organization must have at least one admin.');
		}
		if (existing) {
			await orgQueries.updateOrgMemberRole(orgId, userId, role);
		} else {
			await orgQueries.addOrgMember({ orgId, userId, role });
		}
		return isDemotingAdmin;
	});
	if (lostAdmin) {
		await cleanupLostOrgContextAccess(orgId, userId);
	}
	return { userId, role };
}

export async function removeOrganizationMember(
	orgId: string,
	userId: string,
	options: { ignoreMissing?: boolean } = {},
): Promise<void> {
	await requireOrganization(orgId);
	await withKeyedLock(orgMembersLockKey(orgId), async () => {
		const membership = await orgQueries.getOrgMember(orgId, userId);
		if (!membership && !options.ignoreMissing) {
			throw new HandlerError('NOT_FOUND', 'Organization membership not found');
		}
		if (membership?.role === 'admin' && (await orgQueries.countOrgAdmins(orgId)) <= 1) {
			throw new HandlerError('BAD_REQUEST', 'Cannot remove the last admin from the organization.');
		}
		await orgQueries.removeOrgMemberFromProjects(orgId, userId);
		await orgQueries.removeOrgMember(orgId, userId);
	});
	await cleanupLostOrgContextAccess(orgId, userId);
}

export async function putProjectMember(projectId: string, userId: string, role: UserRole) {
	const [project] = await Promise.all([requireProject(projectId), requireUser(userId)]);
	if (!project.orgId || !(await orgQueries.getOrgMember(project.orgId, userId))) {
		throw new HandlerError('BAD_REQUEST', "User is not a member of the project's organization");
	}
	const previousRole = await withKeyedLock(projectMembersLockKey(projectId), async () => {
		const existing = await projectQueries.getProjectMember(projectId, userId);
		if (
			existing?.role === 'admin' &&
			role !== 'admin' &&
			!(await projectQueries.checkProjectHasMoreThanOneAdmin(projectId))
		) {
			throw new HandlerError('BAD_REQUEST', 'The project must have at least one admin user.');
		}
		const roleBefore = existing?.role ?? (await projectQueries.getUserRoleInProject(projectId, userId));
		if (existing) {
			await projectQueries.updateProjectMemberRole(projectId, userId, role);
		} else {
			await projectQueries.addProjectMember({ projectId, userId, role });
		}
		return roleBefore;
	});
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
	if (!remainingRole) {
		await userGroupQueries.removeUserFromProjectGroups(projectId, userId);
	}
	if (project.path && !isContextRole(remainingRole)) {
		await cleanupContextWorktree(projectId, project.path, userId);
	}
}

function orgMembersLockKey(orgId: string): string {
	return `org-members:${orgId}`;
}

function projectMembersLockKey(projectId: string): string {
	return `project-members:${projectId}`;
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
