import { z } from 'zod/v4';

import * as projectQueries from '../queries/project.queries';
import * as credentialsQueries from '../queries/project-warehouse-credentials.queries';
import * as userQueries from '../queries/user.queries';
import { type WarehouseProvider, warehouseProviderSchema } from '../types/warehouse';
import { decryptSecret, encryptSecret } from '../utils/encryption';
import { HandlerError } from '../utils/error';
import { authenticatedRepoUrl } from './github';

export const ONBOARDING_GITHUB_REPOSITORY_URL_ENV = 'NAO_ONBOARDING_GITHUB_REPOSITORY_URL';
const DISABLED_GITHUB_REPOSITORY_URL = JSON.stringify('https://github.invalid/nao-access-revoked.git');

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

type StoredWarehouseEnv = z.infer<typeof storedWarehouseEnvSchema>;

type ProjectWarehouseCredentialReferences = {
	githubConnection?: {
		userId: string;
		repoFullName: string;
	};
};

export type ProjectWarehouseCredentialsSummary = {
	provider: WarehouseProvider;
	updatedAt: Date;
	fields: { name: string; label: string }[];
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

	const payload = decryptStoredWarehouseEnv(storedCredentials.encryptedCredentials);
	const hadStoredGithubToken = ONBOARDING_GITHUB_REPOSITORY_URL_ENV in payload.envVars;
	const envVars = withoutStoredGithubToken(payload.envVars);
	if (payload.version === 1) {
		return hadStoredGithubToken ? withDisabledGithubRepository(envVars) : envVars;
	}
	if (!payload.githubConnection) {
		return envVars;
	}

	const role = await projectQueries.getUserRoleInProject(projectId, payload.githubConnection.userId);
	if (!role) {
		return withDisabledGithubRepository(envVars);
	}
	const token = await userQueries.getGithubToken(payload.githubConnection.userId);
	if (!token) {
		return withDisabledGithubRepository(envVars);
	}

	return {
		...envVars,
		[ONBOARDING_GITHUB_REPOSITORY_URL_ENV]: JSON.stringify(
			authenticatedRepoUrl(token, payload.githubConnection.repoFullName),
		),
	};
}

/** Describes the stored warehouse credentials of a project without revealing their values. */
export async function getProjectWarehouseCredentialsSummary(
	projectId: string,
): Promise<ProjectWarehouseCredentialsSummary | null> {
	const storedCredentials = await credentialsQueries.getProjectWarehouseCredentials(projectId);
	if (!storedCredentials) {
		return null;
	}

	const envVars = withoutStoredGithubToken(decryptStoredWarehouseEnv(storedCredentials.encryptedCredentials).envVars);
	return {
		provider: storedCredentials.provider,
		updatedAt: storedCredentials.updatedAt,
		fields: Object.keys(envVars)
			.sort()
			.map((name) => ({ name, label: toFieldLabel(name, storedCredentials.provider) })),
	};
}

/** Replaces some of the stored warehouse credentials, keeping the type each value was stored with. */
export async function updateProjectWarehouseCredentials(
	projectId: string,
	values: Record<string, string>,
): Promise<void> {
	const storedCredentials = await credentialsQueries.getProjectWarehouseCredentials(projectId);
	if (!storedCredentials) {
		throw new HandlerError('NOT_FOUND', 'This project has no stored warehouse credentials.');
	}

	const payload = decryptStoredWarehouseEnv(storedCredentials.encryptedCredentials);
	const envVars = withoutStoredGithubToken(payload.envVars);
	const updatedEnvVars = { ...envVars };
	for (const [name, value] of Object.entries(values)) {
		if (!(name in envVars)) {
			throw new HandlerError('BAD_REQUEST', `Unknown warehouse credential: ${name}`);
		}
		updatedEnvVars[name] = encodeLikeStoredValue(envVars[name], value, name);
	}

	await saveProjectWarehouseEnvVars(
		projectId,
		storedCredentials.provider,
		updatedEnvVars,
		payload.version === 2 ? { githubConnection: payload.githubConnection } : {},
	);
}

function decryptStoredWarehouseEnv(encryptedCredentials: string): StoredWarehouseEnv {
	try {
		return storedWarehouseEnvSchema.parse(JSON.parse(decryptSecret(encryptedCredentials)));
	} catch {
		throw new Error('Invalid warehouse environment');
	}
}

function withDisabledGithubRepository(envVars: Record<string, string>): Record<string, string> {
	return {
		...envVars,
		[ONBOARDING_GITHUB_REPOSITORY_URL_ENV]: DISABLED_GITHUB_REPOSITORY_URL,
	};
}

function withoutStoredGithubToken(envVars: Record<string, string>): Record<string, string> {
	const { [ONBOARDING_GITHUB_REPOSITORY_URL_ENV]: _githubRepositoryUrl, ...safeEnvVars } = envVars;
	return safeEnvVars;
}

function encodeLikeStoredValue(storedValue: string, value: string, name: string): string {
	const storedType = typeof parseStoredValue(storedValue);
	if (storedType === 'number') {
		const number = Number(value);
		if (value.trim() === '' || !Number.isFinite(number)) {
			throw new HandlerError('BAD_REQUEST', `${name} must be a number.`);
		}
		return JSON.stringify(number);
	}
	if (storedType === 'boolean') {
		if (value !== 'true' && value !== 'false') {
			throw new HandlerError('BAD_REQUEST', `${name} must be true or false.`);
		}
		return value;
	}
	return JSON.stringify(value);
}

function parseStoredValue(storedValue: string): unknown {
	try {
		return JSON.parse(storedValue);
	} catch {
		return storedValue;
	}
}

function toFieldLabel(name: string, provider: WarehouseProvider): string {
	const prefix = `NAO_ONBOARDING_${provider.toUpperCase().replace(/-/g, '_')}_`;
	const words = (name.startsWith(prefix) ? name.slice(prefix.length) : name).toLowerCase().replace(/_/g, ' ');
	return words.charAt(0).toUpperCase() + words.slice(1);
}
