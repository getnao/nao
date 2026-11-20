export { API_KEY_SCOPES, type ApiKeyScope, DEFAULT_API_KEY_SCOPE, isApiKeyScope } from '@nao/shared/api-key';

export type ApiKeyFailureStatus = 'invalid' | 'scope_mismatch';

/**
 * The answer for a failed key check, so every keyed route reports an unscoped key the same way: 403
 * when the key is real but scoped to another API, 401 when it is not a key at all.
 */
export const apiKeyRejection = (
	status: ApiKeyFailureStatus,
	scopeLabel: string,
): { statusCode: 401 | 403; error: string } =>
	status === 'scope_mismatch'
		? { statusCode: 403, error: `This API key is not scoped for ${scopeLabel}` }
		: { statusCode: 401, error: 'Invalid API key' };
