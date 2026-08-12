/* @license Enterprise */

import type { BetterAuthPlugin } from 'better-auth';
import { APIError } from 'better-auth';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';

import { env } from '../env';
import { decideGroupRoleMapping, parseGroupRoleMapping } from '../utils/sso-group-mapping';
import { isGroupRoleMappingActive } from './sso-group-mapping.service';

export function getOidcProviderId(): string {
	return env.OIDC_PROVIDER_ID ?? 'oidc';
}

export function isOidcConfigured(): boolean {
	return !!(env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET && env.OIDC_DISCOVERY_URL);
}

export function augmentPluginsWithOidc(plugins: BetterAuthPlugin[]): void {
	if (!isOidcConfigured()) {
		return;
	}

	plugins.push(
		genericOAuth({
			config: [
				{
					providerId: getOidcProviderId(),
					discoveryUrl: env.OIDC_DISCOVERY_URL!,
					clientId: env.OIDC_CLIENT_ID!,
					clientSecret: env.OIDC_CLIENT_SECRET!,
					scopes: parseScopes(env.OIDC_SCOPES),
					pkce: env.OIDC_PKCE !== 'false',
					prompt: 'select_account',
					mapProfileToUser: async (profile) => {
						if (!(await isGroupRoleMappingActive())) {
							return {};
						}

						const decision = decideGroupRoleMapping(
							profile,
							env.OIDC_GROUPS_CLAIM ?? DEFAULT_GROUPS_CLAIM,
							parseGroupRoleMapping(env.OIDC_GROUP_ROLE_MAPPING),
						);
						if (decision.action === 'deny') {
							throw new APIError('FORBIDDEN', {
								message: 'Your account is not assigned to any nao access group.',
							});
						}

						return {};
					},
				},
			],
		}),
	);
}

export function getTrustedProvidersForOidc(): string[] {
	if (!isOidcConfigured()) {
		return [];
	}
	return [getOidcProviderId()];
}

export function isSocialProviderOidc(providerId: string | undefined): boolean {
	return providerId === getOidcProviderId();
}

const DEFAULT_SCOPES = ['openid', 'profile', 'email'];
const DEFAULT_GROUPS_CLAIM = 'groups';

export function parseScopes(raw: string | undefined): string[] {
	if (!raw) {
		return DEFAULT_SCOPES;
	}
	const scopes = raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	return scopes.length > 0 ? scopes : DEFAULT_SCOPES;
}
