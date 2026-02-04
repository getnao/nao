import { and, eq } from 'drizzle-orm';

import s, { DBProject, DBProjectMember, NewProject, NewProjectMember } from '../db/abstractSchema';
import { db } from '../db/db';
import { env } from '../env';
import { UserRole, UserWithRole } from '../types/project';
import * as userQueries from './user.queries';

export const getProjectByPath = async (path: string): Promise<DBProject | null> => {
	const [project] = await db.select().from(s.project).where(eq(s.project.path, path)).execute();
	return project ?? null;
};

export const getProjectById = async (id: string): Promise<DBProject | null> => {
	const [project] = await db.select().from(s.project).where(eq(s.project.id, id)).execute();
	return project ?? null;
};

export const createProject = async (project: NewProject): Promise<DBProject> => {
	const [created] = await db.insert(s.project).values(project).returning().execute();
	return created;
};

export const getProjectMember = async (projectId: string, userId: string): Promise<DBProjectMember | null> => {
	const [member] = await db
		.select()
		.from(s.projectMember)
		.where(and(eq(s.projectMember.projectId, projectId), eq(s.projectMember.userId, userId)))
		.execute();
	return member ?? null;
};

export const addProjectMember = async (member: NewProjectMember): Promise<DBProjectMember> => {
	const [created] = await db.insert(s.projectMember).values(member).returning().execute();
	return created;
};

export const removeProjectMember = async (projectId: string, userId: string): Promise<void> => {
	await db
		.delete(s.projectMember)
		.where(and(eq(s.projectMember.projectId, projectId), eq(s.projectMember.userId, userId)))
		.execute();
};

export const updateProjectMemberRole = async (projectId: string, userId: string, newRole: UserRole): Promise<void> => {
	await db
		.update(s.projectMember)
		.set({ role: newRole })
		.where(and(eq(s.projectMember.projectId, projectId), eq(s.projectMember.userId, userId)))
		.execute();
};

export const listUserProjects = async (userId: string): Promise<DBProject[]> => {
	const results = await db
		.select({ project: s.project })
		.from(s.projectMember)
		.innerJoin(s.project, eq(s.projectMember.projectId, s.project.id))
		.where(eq(s.projectMember.userId, userId))
		.execute();
	return results.map((r) => r.project);
};

export const getUserRoleInProject = async (
	projectId: string,
	userId: string,
): Promise<'admin' | 'user' | 'viewer' | null> => {
	const member = await getProjectMember(projectId, userId);
	return member?.role ?? null;
};

export const getAllUsersWithRoles = async (projectId: string): Promise<UserWithRole[]> => {
	const results = await db
		.select({
			id: s.user.id,
			name: s.user.name,
			email: s.user.email,
			role: s.projectMember.role,
		})
		.from(s.user)
		.innerJoin(s.projectMember, eq(s.projectMember.userId, s.user.id))
		.where(eq(s.projectMember.projectId, projectId))
		.execute();

	return results;
};

export const checkUserHasProject = async (userId: string): Promise<DBProject | null> => {
	const projectPath = env.NAO_DEFAULT_PROJECT_PATH;
	if (!projectPath) {
		return null;
	}

	const project = await getProjectByPath(projectPath);
	if (!project) {
		return null;
	}

	const userProject = await getProjectMember(project.id, userId);

	if (!userProject) {
		return null;
	}

	return project;
};

export const checkProjectHasMoreThanOneAdmin = async (projectId: string): Promise<boolean> => {
	const userWithRoles = await getAllUsersWithRoles(projectId);
	const nbAdmin = userWithRoles.filter((u) => u.role === 'admin').length;
	return nbAdmin > 1;
};

/**
 * Create the default project for an organization.
 * Uses NAO_DEFAULT_PROJECT_PATH env var to determine project path.
 * Returns the project, or null if no path configured or project already exists.
 */
export const createDefaultProjectForOrganization = async (orgId: string, userId: string): Promise<DBProject | null> => {
	const projectPath = process.env.NAO_DEFAULT_PROJECT_PATH;
	if (!projectPath) {
		return null;
	}

	const existingProject = await getProjectByPath(projectPath);
	if (existingProject) {
		return null;
	}

	const projectName = projectPath.split('/').pop() || 'Default Project';
	const project = await createProject({
		name: projectName,
		type: 'local',
		path: projectPath,
		orgId,
	});

	await addProjectMember({
		projectId: project.id,
		userId,
		role: 'admin',
	});

	return project;
};
