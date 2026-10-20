import { z } from 'zod/v4';

import * as credentialsQueries from '../queries/project-warehouse-credentials.queries';
import { type WarehouseProvider, warehouseProviderSchema } from '../types/warehouse';
import { decryptSecret, encryptSecret } from '../utils/encryption';

const storedWarehouseEnvSchema = z.object({
	version: z.literal(1),
	envVars: z.record(z.string(), z.string()),
});

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
	if (!storedCredentials) {
		return {};
	}

	try {
		const decryptedPayload = decryptSecret(storedCredentials.encryptedCredentials);
		const payload = storedWarehouseEnvSchema.parse(JSON.parse(decryptedPayload));
		return payload.envVars;
	} catch {
		throw new Error('Invalid warehouse environment');
	}
}
