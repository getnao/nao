import { canRoleManagePersonalSkills, type UserRole } from '@nao/shared';
import { TRPCError } from '@trpc/server';

import type { DBUserSkill } from '../db/abstractSchema';
import * as userSkillQueries from '../queries/user-skill.queries';
import type { PersonalSkill, UserSkillShareStatus } from '../types/user-skill';
import { logger } from '../utils/logger';
import type { ContextExplorerFileAccess } from './context-explorer.service';
import { createDraftFile } from './context-explorer.service';
import { skillService } from './skill';
import { hasUserGroupFeature } from './user-group-feature-access.service';

export interface PersonalSkillInput {
	name: string;
	description: string;
	body: string;
}

/** Admins and context admins always write personal skills, members when one of their groups grants them. */
export async function canManagePersonalSkills(
	projectId: string,
	userId: string,
	role: UserRole | null,
): Promise<boolean> {
	const groupsGrantPersonalSkills =
		role === 'user' && (await hasUserGroupFeature(projectId, userId, 'personalSkills'));
	return canRoleManagePersonalSkills(role, groupsGrantPersonalSkills);
}

/** A project skill takes the name for everyone, so a personal skill that shares it is no longer offered. */
export async function listPersonalSkills(projectId: string, userId: string): Promise<DBUserSkill[]> {
	const [skills, projectSkillNames] = await Promise.all([
		userSkillQueries.listUserSkills(projectId, userId),
		getProjectSkillNames(projectId),
	]);
	return skills.filter((skill) => !projectSkillNames.has(skill.name));
}

/** What the agent reads of the author's personal skills; never fails a run over them. */
export async function safeListPersonalSkillsForAgent(projectId: string, userId: string): Promise<PersonalSkill[]> {
	try {
		const skills = await listPersonalSkills(projectId, userId);
		return skills.map(({ name, description, body }) => ({ name, description, body }));
	} catch (error) {
		logger.warn(`Failed to load personal skills: ${String(error)}`, { source: 'agent' });
		return [];
	}
}

export async function createPersonalSkill(
	projectId: string,
	userId: string,
	input: PersonalSkillInput,
): Promise<DBUserSkill> {
	const projectSkillNames = await getProjectSkillNames(projectId);
	if (projectSkillNames.has(input.name)) {
		throw new TRPCError({ code: 'CONFLICT', message: `The project already has a skill called '${input.name}'.` });
	}
	if (await userSkillQueries.getUserSkill(projectId, userId, input.name)) {
		throw new TRPCError({ code: 'CONFLICT', message: `You already have a skill called '${input.name}'.` });
	}
	return userSkillQueries.createUserSkill({ projectId, userId, ...input });
}

export async function requestPersonalSkillShare(
	projectId: string,
	userId: string,
	name: string,
	note: string | null,
): Promise<DBUserSkill> {
	const skill = await userSkillQueries.updateUserSkill(projectId, userId, name, {
		shareStatus: 'requested',
		shareNote: note,
		shareRequestedAt: new Date(),
	});
	return skill ?? throwSkillNotFound(name);
}

/** Adds the skill to the admin's context changes; it is shared with everyone once those changes are published. */
export async function acceptShareRequest(
	projectId: string,
	requestId: string,
	access: ContextExplorerFileAccess,
): Promise<{ path: string }> {
	const request = await getOpenShareRequest(projectId, requestId);
	await claimShareRequest(projectId, requestId, 'accepted');
	const path = `/agent/skills/${request.name}.md`;
	try {
		await createDraftFile(path, buildSkillFile(request), access);
	} catch (error) {
		await userSkillQueries.moveUserSkillShareStatus(projectId, requestId, 'accepted', 'requested');
		throw error;
	}
	return { path };
}

export async function declineShareRequest(projectId: string, requestId: string): Promise<void> {
	await claimShareRequest(projectId, requestId, 'declined');
}

async function claimShareRequest(projectId: string, requestId: string, decision: UserSkillShareStatus): Promise<void> {
	if (!(await userSkillQueries.moveUserSkillShareStatus(projectId, requestId, 'requested', decision))) {
		throwShareRequestGone();
	}
}

async function getOpenShareRequest(
	projectId: string,
	requestId: string,
): Promise<userSkillQueries.UserSkillWithAuthor> {
	const request = await userSkillQueries.getUserSkillById(projectId, requestId);
	return request?.shareStatus === 'requested' ? request : throwShareRequestGone();
}

function throwShareRequestGone(): never {
	throw new TRPCError({ code: 'NOT_FOUND', message: 'This share request no longer exists.' });
}

async function getProjectSkillNames(projectId: string): Promise<Set<string>> {
	await skillService.initializeSkills(projectId);
	return new Set(skillService.getSkills(projectId).map((skill) => skill.name));
}

function buildSkillFile(skill: userSkillQueries.UserSkillWithAuthor): string {
	return [
		'---',
		`name: ${skill.name}`,
		`description: ${JSON.stringify(skill.description)}`,
		`owner: ${skill.authorEmail}`,
		'---',
		'',
		skill.body.trim(),
		'',
	].join('\n');
}

function throwSkillNotFound(name: string): never {
	throw new TRPCError({ code: 'NOT_FOUND', message: `You have no skill called '${name}'.` });
}
