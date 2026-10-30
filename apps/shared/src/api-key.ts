export const API_KEY_SCOPES = ['deploy', 'user_management'] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const DEFAULT_API_KEY_SCOPE: ApiKeyScope = 'deploy';

export const isApiKeyScope = (value: string): value is ApiKeyScope =>
	(API_KEY_SCOPES as readonly string[]).includes(value);
