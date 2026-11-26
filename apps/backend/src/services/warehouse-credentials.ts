import { z } from 'zod/v4';

import * as credentialsQueries from '../queries/project-warehouse-credentials.queries';
import { type WarehouseProvider, warehouseProviderSchema } from '../types/warehouse';
import { decryptSecret, encryptSecret } from '../utils/encryption';
import { HandlerError } from '../utils/error';

const storedWarehouseEnvSchema = z.object({
	version: z.literal(1),
	envVars: z.record(z.string(), z.string()),
});

export type ProjectWarehouseCredentialsSummary = {
	provider: WarehouseProvider;
	updatedAt: Date;
	fields: { name: string; label: string }[];
};

export async function saveProjectWarehouseEnvVars(
	projectId: string,
	provider: WarehouseProvider,
	envVars: Record<string, string>,
): Promise<void> {
	const validatedProvider = warehouseProviderSchema.parse(provider);
	const payload = storedWarehouseEnvSchema.parse({ version: 1, envVars });
	const encryptedPayload = encryptSecret(JSON.stringify(payload));

	await credentialsQueries.upsertProjectWarehouseCredentials(projectId, validatedProvider, encryptedPayload);
}

export async function getProjectWarehouseEnvVars(projectId: string): Promise<Record<string, string>> {
	const storedCredentials = await credentialsQueries.getProjectWarehouseCredentials(projectId);
	return storedCredentials ? decryptStoredEnvVars(storedCredentials.encryptedCredentials) : {};
}

/** Describes the stored warehouse credentials of a project without revealing their values. */
export async function getProjectWarehouseCredentialsSummary(
	projectId: string,
): Promise<ProjectWarehouseCredentialsSummary | null> {
	const storedCredentials = await credentialsQueries.getProjectWarehouseCredentials(projectId);
	if (!storedCredentials) {
		return null;
	}

	const envVars = decryptStoredEnvVars(storedCredentials.encryptedCredentials);
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

	const envVars = decryptStoredEnvVars(storedCredentials.encryptedCredentials);
	const updatedEnvVars = { ...envVars };
	for (const [name, value] of Object.entries(values)) {
		if (!(name in envVars)) {
			throw new HandlerError('BAD_REQUEST', `Unknown warehouse credential: ${name}`);
		}
		updatedEnvVars[name] = encodeLikeStoredValue(envVars[name], value, name);
	}

	await saveProjectWarehouseEnvVars(projectId, storedCredentials.provider, updatedEnvVars);
}

function decryptStoredEnvVars(encryptedCredentials: string): Record<string, string> {
	try {
		const payload = storedWarehouseEnvSchema.parse(JSON.parse(decryptSecret(encryptedCredentials)));
		return payload.envVars;
	} catch {
		throw new Error('Invalid warehouse environment');
	}
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
