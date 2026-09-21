import { USER_ROLES, type UserRole } from './types';

export const SSO_GROUP_PROVIDERS = ['oidc', 'microsoft'] as const;

export type SsoGroupProvider = (typeof SSO_GROUP_PROVIDERS)[number];

export interface UserGroupSsoMappings {
	version: 1;
	providers: Record<SsoGroupProvider, string[]>;
	defaultProjectRole?: UserRole | null;
}

export type StoredUserGroupSsoMappings = UserGroupSsoMappings | Record<string, unknown> | null;

export const EMPTY_USER_GROUP_SSO_MAPPINGS: UserGroupSsoMappings = {
	version: 1,
	providers: {
		oidc: [],
		microsoft: [],
	},
	defaultProjectRole: null,
};

export function normalizeUserGroupSsoMappings(value: unknown): UserGroupSsoMappings {
	const parsed = parseJson(value);
	const providers = getProviders(parsed);

	return {
		version: 1,
		providers: {
			oidc: normalizeSsoGroupIdentifiers('oidc', providers?.oidc),
			microsoft: normalizeSsoGroupIdentifiers('microsoft', providers?.microsoft),
		},
		defaultProjectRole: normalizeDefaultProjectRole(parsed),
	};
}

export function parseStoredUserGroupSsoMappings(value: unknown): UserGroupSsoMappings {
	return normalizeUserGroupSsoMappings(value);
}

export function serializeUserGroupSsoMappings(value: unknown): UserGroupSsoMappings {
	const normalized = normalizeUserGroupSsoMappings(value);
	return normalized.defaultProjectRole
		? normalized
		: {
				version: normalized.version,
				providers: normalized.providers,
			};
}

export function normalizeSsoGroupIdentifiers(provider: SsoGroupProvider, value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const identifiers = value
		.filter((identifier): identifier is string => typeof identifier === 'string')
		.map((identifier) => normalizeSsoGroupIdentifier(provider, identifier))
		.filter(Boolean);

	return [...new Set(identifiers)];
}

export function normalizeSsoGroupIdentifier(provider: SsoGroupProvider, value: string): string {
	const identifier = value.trim();
	return provider === 'oidc' || provider === 'microsoft' ? identifier.toLowerCase() : identifier;
}

export function isMicrosoftEntraGroupId(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

function parseJson(value: unknown): unknown {
	if (typeof value !== 'string') {
		return value;
	}

	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

function getProviders(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}

	const record = value as Record<string, unknown>;
	const providers = record.providers;
	if (providers && typeof providers === 'object' && !Array.isArray(providers)) {
		return providers as Record<string, unknown>;
	}

	return record;
}

function normalizeDefaultProjectRole(value: unknown): UserRole | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}

	const role = (value as Record<string, unknown>).defaultProjectRole;
	return typeof role === 'string' && (USER_ROLES as readonly string[]).includes(role) ? (role as UserRole) : null;
}
