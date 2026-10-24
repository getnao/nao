import { z } from 'zod/v4';

import * as projectQueries from '../queries/project.queries';
import * as credentialsQueries from '../queries/project-warehouse-credentials.queries';
import * as userQueries from '../queries/user.queries';
import { type WarehouseProvider, warehouseProviderSchema } from '../types/warehouse';
import { decryptSecret, encryptSecret } from '../utils/encryption';
import { authenticatedRepoUrl } from './github';

export const ONBOARDING_GITHUB_REPOSITORY_URL_ENV = 'NAO_ONBOARDING_GITHUB_REPOSITORY_URL';

const storedWarehouseEnvSchema = z.discriminatedUnion('version', [
	z.object({
		version: z.literal(1),
		envVars: z.record(z.string(), z.string()),
	}),
	z.object({
		version: z.literal(2),
		envVars: z.record(z.string(), z.string()),
		githubConnection: z
			.object({
				userId: z.string().min(1),
				repoFullName: z.string().min(1),
			})
			.optional(),
	}),
]);

type ProjectWarehouseCredentialReferences = {
	githubConnection?: {
		userId: string;
		repoFullName: string;
	};
};

export async function saveProjectWarehouseEnvVars(
	projectId: string,
	provider: WarehouseProvider,
	envVars: Record<string, string>,
	references: ProjectWarehouseCredentialReferences = {},
): Promise<void> {
	const validatedProvider = warehouseProviderSchema.parse(provider);
	const payload = storedWarehouseEnvSchema.parse({
		version: 2,
		envVars: withoutStoredGithubToken(envVars),
		...references,
	});
	const encryptedPayload = encryptSecret(JSON.stringify(payload));

	await credentialsQueries.upsertProjectWarehouseCredentials(projectId, validatedProvider, encryptedPayload);
}

export async function getProjectWarehouseEnvVars(projectId: string): Promise<Record<string, string>> {
	const storedCredentials = await credentialsQueries.getProjectWarehouseCredentials(projectId);
	if (!storedCredentials) {
		return {};
	}

	let payload: z.infer<typeof storedWarehouseEnvSchema>;
	try {
		const decryptedPayload = decryptSecret(storedCredentials.encryptedCredentials);
		payload = storedWarehouseEnvSchema.parse(JSON.parse(decryptedPayload));
	} catch {
		throw new Error('Invalid warehouse environment');
	}

	const envVars = withoutStoredGithubToken(payload.envVars);
	if (payload.version === 1 || !payload.githubConnection) {
		return envVars;
	}

	const role = await projectQueries.getUserRoleInProject(projectId, payload.githubConnection.userId);
	if (!role) {
		return envVars;
	}
	const token = await userQueries.getGithubToken(payload.githubConnection.userId);
	if (!token) {
		return envVars;
	}

	return {
		...envVars,
		[ONBOARDING_GITHUB_REPOSITORY_URL_ENV]: JSON.stringify(
			authenticatedRepoUrl(token, payload.githubConnection.repoFullName),
		),
	};
}

function withoutStoredGithubToken(envVars: Record<string, string>): Record<string, string> {
	const { [ONBOARDING_GITHUB_REPOSITORY_URL_ENV]: _githubRepositoryUrl, ...safeEnvVars } = envVars;
	return safeEnvVars;
}
