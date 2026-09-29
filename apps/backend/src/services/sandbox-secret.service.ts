import * as sandboxSecretQueries from '../queries/sandbox-secret.queries';
import { SandboxSecretSummary } from '../queries/sandbox-secret.queries';
import { decryptSecret, encryptSecret } from '../utils/encryption';

/** What the model is allowed to know about a secret: its name and what it is for, never its value. */
export interface SandboxSecretDefinition {
	name: string;
	description: string | null;
}

/** A decrypted secret, only ever handed to the sandbox runtime. */
export interface ResolvedSandboxSecret {
	name: string;
	value: string;
}

export const sandboxSecretService = {
	list(userId: string, projectId: string): Promise<SandboxSecretSummary[]> {
		return sandboxSecretQueries.listSandboxSecretSummaries(userId, projectId);
	},

	set(
		userId: string,
		projectId: string,
		input: { name: string; value: string; description?: string | null },
	): Promise<SandboxSecretSummary> {
		return sandboxSecretQueries.upsertSandboxSecret({
			userId,
			projectId,
			name: input.name,
			encryptedValue: encryptSecret(input.value),
			description: normalizeDescription(input.description),
		});
	},

	updateDescription(
		userId: string,
		projectId: string,
		secretId: string,
		description: string | null | undefined,
	): Promise<SandboxSecretSummary | null> {
		return sandboxSecretQueries.updateSandboxSecretDescription(
			userId,
			projectId,
			secretId,
			normalizeDescription(description),
		);
	},

	delete(userId: string, projectId: string, secretId: string): Promise<SandboxSecretSummary | null> {
		return sandboxSecretQueries.deleteSandboxSecret(userId, projectId, secretId);
	},

	async listDefinitions(userId: string, projectId: string): Promise<SandboxSecretDefinition[]> {
		const secrets = await sandboxSecretQueries.listSandboxSecretSummaries(userId, projectId);
		return secrets.map(({ name, description }) => ({ name, description }));
	},

	async safeListDefinitions(userId: string, projectId: string): Promise<SandboxSecretDefinition[]> {
		try {
			return await this.listDefinitions(userId, projectId);
		} catch (error) {
			console.error('Failed to load sandbox secret definitions', error);
			return [];
		}
	},

	async resolve(userId: string, projectId: string): Promise<ResolvedSandboxSecret[]> {
		const secrets = await sandboxSecretQueries.listSandboxSecrets(userId, projectId);
		return secrets.map(({ name, encryptedValue }) => ({ name, value: decryptSecret(encryptedValue) }));
	},
};

function normalizeDescription(description: string | null | undefined): string | null {
	const trimmed = description?.trim();
	return trimmed ? trimmed : null;
}
