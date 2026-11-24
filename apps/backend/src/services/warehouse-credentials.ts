import { z } from 'zod/v4';

import * as credentialsQueries from '../queries/project-warehouse-credentials.queries';
import { githubFineGrainedAccessTokenSchema } from '../types/onboarding/warehouse-provisioning';
import { type WarehouseProvider, warehouseProviderSchema } from '../types/warehouse';
import { decryptSecret, encryptSecret } from '../utils/encryption';
import { HandlerError } from '../utils/error';
import { authenticatedRepoUrl, validateRepositoryAccess } from './github';

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
	z.object({
		version: z.literal(3),
		envVars: z.record(z.string(), z.string()),
		githubConnection: z
			.object({
				repoFullName: z.string().min(1),
				accessToken: githubFineGrainedAccessTokenSchema.optional(),
			})
			.optional(),
	}),
]);

type StoredWarehouseEnv = z.infer<typeof storedWarehouseEnvSchema>;

type ProjectWarehouseCredentialReferences = {
	githubConnection?: {
		repoFullName: string;
		accessToken?: string;
	};
};

export type ProjectWarehouseCredentialsSummary = {
	provider: WarehouseProvider;
	updatedAt: Date;
	fields: { name: string; label: string }[];
	githubConnection: {
		repoFullName: string;
		connected: boolean;
	} | null;
};

export async function saveProjectWarehouseEnvVars(
	projectId: string,
	provider: WarehouseProvider,
	envVars: Record<string, string>,
	references: ProjectWarehouseCredentialReferences = {},
): Promise<void> {
	const validatedProvider = warehouseProviderSchema.parse(provider);
	const payload = storedWarehouseEnvSchema.parse({
		version: 3,
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
	if (payload.version === 2) {
		return payload.githubConnection ? withDisabledGithubRepository(envVars) : envVars;
	}
	if (!payload.githubConnection) {
		return envVars;
	}
	if (!payload.githubConnection.accessToken) {
		return withDisabledGithubRepository(envVars);
	}

	return {
		...envVars,
		[ONBOARDING_GITHUB_REPOSITORY_URL_ENV]: JSON.stringify(
			authenticatedRepoUrl(payload.githubConnection.accessToken, payload.githubConnection.repoFullName),
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

	const payload = decryptStoredWarehouseEnv(storedCredentials.encryptedCredentials);
	const envVars = withoutStoredGithubToken(payload.envVars);
	const githubConnection =
		payload.version === 1 || !payload.githubConnection
			? null
			: {
					repoFullName: payload.githubConnection.repoFullName,
					connected: payload.version === 3 && Boolean(payload.githubConnection.accessToken),
				};
	return {
		provider: storedCredentials.provider,
		updatedAt: storedCredentials.updatedAt,
		fields: Object.keys(envVars)
			.sort()
			.map((name) => ({ name, label: toFieldLabel(name, storedCredentials.provider) })),
		githubConnection,
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

	await saveProjectWarehouseEnvVars(projectId, storedCredentials.provider, updatedEnvVars, {
		githubConnection:
			payload.version === 3
				? payload.githubConnection
				: payload.version === 2 && payload.githubConnection
					? { repoFullName: payload.githubConnection.repoFullName }
					: undefined,
	});
}

export async function updateProjectGithubContextToken(projectId: string, accessToken: string | null): Promise<void> {
	const storedCredentials = await credentialsQueries.getProjectWarehouseCredentials(projectId);
	if (!storedCredentials) {
		throw new HandlerError('NOT_FOUND', 'This project has no stored warehouse credentials.');
	}

	const payload = decryptStoredWarehouseEnv(storedCredentials.encryptedCredentials);
	const githubConnection = payload.version === 1 ? undefined : payload.githubConnection;
	if (!githubConnection) {
		throw new HandlerError('NOT_FOUND', 'This project has no GitHub context source.');
	}

	const validatedToken = accessToken ? githubFineGrainedAccessTokenSchema.parse(accessToken) : undefined;
	if (validatedToken) {
		try {
			await validateRepositoryAccess(validatedToken, githubConnection.repoFullName);
		} catch {
			throw new HandlerError(
				'BAD_REQUEST',
				'Could not access this repository. Check the token and its Contents permission.',
			);
		}
	}

	await saveProjectWarehouseEnvVars(
		projectId,
		storedCredentials.provider,
		withoutStoredGithubToken(payload.envVars),
		{
			githubConnection: {
				repoFullName: githubConnection.repoFullName,
				accessToken: validatedToken,
			},
		},
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
