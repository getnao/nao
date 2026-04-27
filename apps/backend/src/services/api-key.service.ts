import crypto from 'node:crypto';

import type { DBOrganization } from '../db/abstractSchema';
import * as apiKeyQueries from '../queries/api-key.queries';

const KEY_PREFIX = 'nao_';
const KEY_RANDOM_BYTES = 16;

export interface GeneratedKey {
	plaintext: string;
	hash: string;
	prefix: string;
}

export const generateApiKey = (): GeneratedKey => {
	const randomHex = crypto.randomBytes(KEY_RANDOM_BYTES).toString('hex');
	const plaintext = `${KEY_PREFIX}${randomHex}`;
	const hash = hashKey(plaintext);
	const prefix = plaintext.slice(0, 12);
	return { plaintext, hash, prefix };
};

export const hashKey = (plaintext: string): string => {
	return crypto.createHash('sha256').update(plaintext).digest('hex');
};

export const validateApiKey = async (plaintext: string): Promise<DBOrganization | null> => {
	if (!plaintext.startsWith(KEY_PREFIX)) {
		return null;
	}

	const hash = hashKey(plaintext);
	const apiKey = await apiKeyQueries.getApiKeyByHash(hash);
	if (!apiKey) {
		return null;
	}

	apiKeyQueries.updateApiKeyLastUsed(apiKey.id).catch(() => {});

	const { getOrganizationById } = await import('../queries/organization.queries');
	return getOrganizationById(apiKey.orgId);
};
