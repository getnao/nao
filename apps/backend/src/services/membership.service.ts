import type { UserRole } from '@nao/shared/types';

import type { DBOrgMember, DBProjectMember, NewOrgMember, NewProjectMember } from '../db/abstractSchema';
import * as orgQueries from '../queries/organization.queries';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
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
	if (existing?.role === 'admin' && role !== 'admin' && (await orgQueries.countOrgAdmins(orgId)) <= 1) {
		throw new HandlerError('BAD_REQUEST', 'The organization must have at least one admin.');
	}
	if (existing) {
		await orgQueries.updateOrgMemberRole(orgId, userId, role);
		if (existing.role === 'admin' && role !== 'admin') {
			await cleanupLostOrgContextAccess(orgId, userId);
		}
	} else {
		await createOrganizationMember({ orgId, userId, role });
	}
	return { userId, role };
}

export async function removeOrganizationMember(
	orgId: string,
	userId: string,
	options: { ignoreMissing?: boolean } = {},
): Promise<void> {
	await requireOrganization(orgId);
	const membership = await orgQueries.getOrgMember(orgId, userId);
	if (!membership && !options.ignoreMissing) {
		throw new HandlerError('NOT_FOUND', 'Organization membership not found');
	}
	if (membership?.role === 'admin' && (await orgQueries.countOrgAdmins(orgId)) <= 1) {
		throw new HandlerError('BAD_REQUEST', 'Cannot remove the last admin from the organization.');
	}
	await orgQueries.removeOrgMemberFromProjects(orgId, userId);
	await orgQueries.removeOrgMember(orgId, userId);
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
