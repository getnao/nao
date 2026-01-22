import { and, eq } from 'drizzle-orm';

import s, {
	DBProject,
	DBProjectLlmConfig,
	DBProjectMember,
	DBProjectSlackConfig,
	NewProject,
	NewProjectLlmConfig,
	NewProjectMember,
	NewProjectSlackConfig,
} from '../db/abstractSchema';
import { db } from '../db/db';

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

export const ensureDefaultProjectMembership = async (userId: string): Promise<DBProject | null> => {
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
		// Add user as a regular user (first admin is set during signup in auth.ts)
		// Might be moved elsewhere after we worked on signup flow in another PR (cc. @mateo)
		await addProjectMember({
			projectId: project.id,
			userId,
			role: 'user',
		});
	}

	return project;
};

// LLM Config queries

export const getProjectLlmConfigs = async (projectId: string): Promise<DBProjectLlmConfig[]> => {
	return db.select().from(s.projectLlmConfig).where(eq(s.projectLlmConfig.projectId, projectId)).execute();
};

export const getProjectLlmConfigByProvider = async (
	projectId: string,
	provider: 'openai' | 'anthropic',
): Promise<DBProjectLlmConfig | null> => {
	const [config] = await db
		.select()
		.from(s.projectLlmConfig)
		.where(and(eq(s.projectLlmConfig.projectId, projectId), eq(s.projectLlmConfig.provider, provider)))
		.execute();
	return config ?? null;
};

export const upsertProjectLlmConfig = async (
	config: Omit<NewProjectLlmConfig, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<DBProjectLlmConfig> => {
	const existing = await getProjectLlmConfigByProvider(config.projectId, config.provider);

	if (existing) {
		const [updated] = await db
			.update(s.projectLlmConfig)
			.set({ apiKey: config.apiKey })
			.where(eq(s.projectLlmConfig.id, existing.id))
			.returning()
			.execute();
		return updated;
	}

	const [created] = await db.insert(s.projectLlmConfig).values(config).returning().execute();
	return created;
};

export const deleteProjectLlmConfig = async (projectId: string, provider: 'openai' | 'anthropic'): Promise<void> => {
	await db
		.delete(s.projectLlmConfig)
		.where(and(eq(s.projectLlmConfig.projectId, projectId), eq(s.projectLlmConfig.provider, provider)))
		.execute();
};

// Slack Config queries

export const getProjectSlackConfig = async (projectId: string): Promise<DBProjectSlackConfig | null> => {
	const [config] = await db
		.select()
		.from(s.projectSlackConfig)
		.where(eq(s.projectSlackConfig.projectId, projectId))
		.execute();
	return config ?? null;
};

export const upsertProjectSlackConfig = async (
	config: Omit<NewProjectSlackConfig, 'id' | 'createdAt' | 'updatedAt' | 'postMessageUrl'>,
): Promise<DBProjectSlackConfig> => {
	const existing = await getProjectSlackConfig(config.projectId);

	if (existing) {
		const [updated] = await db
			.update(s.projectSlackConfig)
			.set({
				botToken: config.botToken,
				signingSecret: config.signingSecret,
			})
			.where(eq(s.projectSlackConfig.id, existing.id))
			.returning()
			.execute();
		return updated;
	}

	const [created] = await db.insert(s.projectSlackConfig).values(config).returning().execute();
	return created;
};

export const deleteProjectSlackConfig = async (projectId: string): Promise<void> => {
	await db.delete(s.projectSlackConfig).where(eq(s.projectSlackConfig.projectId, projectId)).execute();
};
