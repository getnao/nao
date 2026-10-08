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

	// Unknown scopes fail closed: only a row written before migration 0077 (no scope at all) keeps the
	// legacy deploy behaviour, so a bad value from a manual edit or a newer server cannot grant a scope.
	const scope = apiKey.scope ?? DEFAULT_API_KEY_SCOPE;
	if (!isApiKeyScope(scope)) {
		return { status: 'invalid' };
	}
	if (scope !== requiredScope) {
		return { status: 'scope_mismatch' };
	}

	const { getOrganizationById } = await import('../queries/organization.queries');
	const org = await getOrganizationById(apiKey.orgId);
	return org ? { status: 'ok', org, scope } : { status: 'invalid' };
};

/**
 * The key check for the deploy and automation routes. Returns the full check so a caller can answer
 * 403 for a real key scoped elsewhere instead of collapsing that to "invalid" (401).
 */
export const validateApiKey = (plaintext: string): Promise<ApiKeyCheck> =>
	checkApiKey(plaintext, DEFAULT_API_KEY_SCOPE);
