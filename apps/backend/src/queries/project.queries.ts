import { and, eq } from 'drizzle-orm';

import s, { DBProject, DBProjectMember, NewProject, NewProjectMember } from '../db/abstractSchema';
import { db } from '../db/db';
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

export const checkUserHasProject = async (userId: string): Promise<DBProject | null> => {
	const projectPath = process.env.NAO_DEFAULT_PROJECT_PATH;
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

export const initializeDefaultProjectForFirstUser = async (userId: string): Promise<void> => {
	const projectPath = process.env.NAO_DEFAULT_PROJECT_PATH;
	if (!projectPath) {
		return;
	}

	const userCount = await userQueries.countUsers();
	if (userCount !== 1) {
		return;
	}

	const existingProject = await getProjectByPath(projectPath);
	if (existingProject) {
		return;
	}

	const projectName = projectPath.split('/').pop() || 'Default Project';
	const project = await createProject({
		name: projectName,
		type: 'local',
		path: projectPath,
	});

	await addProjectMember({
		projectId: project.id,
		userId,
		role: 'admin',
	});
};

/**
 * Startup check: If NAO_DEFAULT_PROJECT_PATH is defined, there's a project with that path
 * but no admin, auto-assign that the first user as admin.
 */
export const assignAdminToOrphanedProject = async (): Promise<void> => {
	const projectPath = process.env.NAO_DEFAULT_PROJECT_PATH;
	if (!projectPath) {
		throw new Error('[Startup] NAO_DEFAULT_PROJECT_PATH environment variable is not defined.');
	}

	const firstUser = await userQueries.getFirstUser();
	if (!firstUser) {
		return;
	}

	await initializeDefaultProjectForFirstUser(firstUser.id);
};
