import { and, eq } from 'drizzle-orm';

import s, { AgentSettings, DBProject, DBProjectMember, NewProject, NewProjectMember } from '../db/abstractSchema';
import { db } from '../db/db';
import { env } from '../env';
import { UserRole, UserWithRole } from '../types/project';

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

export const getDefaultProject = async (): Promise<DBProject | null> => {
	const projectPath = env.NAO_DEFAULT_PROJECT_PATH;
	if (!projectPath) {
		return null;
	}
	return getProjectByPath(projectPath);
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

export const getAgentSettings = async (projectId: string): Promise<AgentSettings | null> => {
	const project = await getProjectById(projectId);
	return project?.agentSettings ?? null;
};

export const updateAgentSettings = async (projectId: string, settings: AgentSettings): Promise<AgentSettings> => {
	await db.update(s.project).set({ agentSettings: settings }).where(eq(s.project.id, projectId)).execute();
	return settings;
};
