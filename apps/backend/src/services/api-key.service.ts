import crypto from 'node:crypto';

import type { DBOrganization } from '../db/abstractSchema';
import * as apiKeyQueries from '../queries/api-key.queries';
import { type ApiKeyScope, DEFAULT_API_KEY_SCOPE, isApiKeyScope } from '../types/api-key';

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

export type ApiKeyCheck =
	| { status: 'ok'; org: DBOrganization; scope: ApiKeyScope }
	| { status: 'invalid' }
	| { status: 'scope_mismatch' };

export const checkApiKey = async (plaintext: string, requiredScope: ApiKeyScope): Promise<ApiKeyCheck> => {
	if (!plaintext.startsWith(KEY_PREFIX)) {
		return { status: 'invalid' };
	}

	const hash = hashKey(plaintext);
	const apiKey = await apiKeyQueries.getApiKeyByHash(hash);
	if (!apiKey) {
		return { status: 'invalid' };
	}

	apiKeyQueries.updateApiKeyLastUsed(apiKey.id).catch(() => {});

	const scope = isApiKeyScope(apiKey.scope) ? apiKey.scope : DEFAULT_API_KEY_SCOPE;
	if (scope !== requiredScope) {
		return { status: 'scope_mismatch' };
	}

	const { getOrganizationById } = await import('../queries/organization.queries');
	const org = await getOrganizationById(apiKey.orgId);
	return org ? { status: 'ok', org, scope } : { status: 'invalid' };
};

export const validateApiKey = async (plaintext: string): Promise<DBOrganization | null> => {
	const check = await checkApiKey(plaintext, DEFAULT_API_KEY_SCOPE);
	return check.status === 'ok' ? check.org : null;
};
