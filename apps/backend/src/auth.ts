import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { db } from './db/db';
import dbConfig, { Dialect } from './db/dbConfig';
import { addProjectMember, createProject, getProjectByPath } from './queries/project.queries';
import { countUsers } from './queries/user.queries';

const initializeDefaultProjectForFirstUser = async (userId: string): Promise<void> => {
	const projectPath = process.env.NAO_DEFAULT_PROJECT_PATH;
	if (!projectPath) {
		return;
	}

	const userCount = await countUsers();
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

	const openaiKey = process.env.OPENAI_API_KEY;
	const anthropicKey = process.env.ANTHROPIC_API_KEY;

	if (openaiKey) {
		const { upsertProjectLlmConfig } = await import('./queries/project.queries');
		await upsertProjectLlmConfig({ projectId: project.id, provider: 'openai', apiKey: openaiKey });
	}

	if (anthropicKey) {
		const { upsertProjectLlmConfig } = await import('./queries/project.queries');
		await upsertProjectLlmConfig({ projectId: project.id, provider: 'anthropic', apiKey: anthropicKey });
	}

	await addProjectMember({
		projectId: project.id,
		userId,
		role: 'admin',
	});
};

export const auth = betterAuth({
	secret: process.env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, {
		provider: dbConfig.dialect === Dialect.Postgres ? 'pg' : 'sqlite',
		schema: dbConfig.schema,
	}),
	emailAndPassword: {
		enabled: true,
	},
	socialProviders: {
		google: {
			prompt: 'select_account',
			clientId: process.env.GOOGLE_CLIENT_ID as string,
			clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
		},
	},
	databaseHooks: {
		user: {
			create: {
				async after(user) {
					// Handle first user signup: create default project and add user as admin
					await initializeDefaultProjectForFirstUser(user.id);
				},
			},
		},
	},
});
