/* @license Enterprise */

import { APIError, type BetterAuthOptions } from 'better-auth';
import { microsoft } from 'better-auth/social-providers';
import { and, eq } from 'drizzle-orm';
import { decodeJwt } from 'jose';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import { env } from '../env';
import { logger, serializeError } from '../utils/logger';
import {
	decideGroupOrganizationRoleMapping,
	hasMicrosoftGroupsOverage,
	parseEntraGroupOrganizationRoleMapping,
} from '../utils/sso-group-mapping';
import { hasFeature, LICENSE_FEATURES } from './license.service';

export type SocialProviders = NonNullable<BetterAuthOptions['socialProviders']>;

interface AzureAdConfig {
	clientId: string;
	clientSecret: string;
	tenantId: string;
	tokenScope: string;
}

export function augmentSocialProvidersWithMicrosoft(providers: SocialProviders): void {
	const config = azureAdEnv();
	if (!config) {
		return;
	}
	const stockProvider = microsoft({
		clientId: config.clientId,
		clientSecret: config.clientSecret,
		tenantId: config.tenantId,
	});
	providers.microsoft = {
		clientId: config.clientId,
		clientSecret: config.clientSecret,
		tenantId: config.tenantId,
		getUserInfo: async (token) => {
			await assertMicrosoftGroupAccess(token);
			return stockProvider.getUserInfo(token);
		},
	};
}

async function assertMicrosoftGroupAccess(token: { idToken?: string; accessToken?: string }): Promise<void> {
	const roleMapping = parseEntraGroupOrganizationRoleMapping(env.AZURE_AD_GROUP_NAO_ROLE_MAPPING);
	if (roleMapping.status !== 'valid' || roleMapping.mapping.size === 0 || !(await hasFeature(LICENSE_FEATURES.sso))) {
		return;
	}
	if (!token.idToken) {
		throw new APIError('FORBIDDEN', {
			message: 'Microsoft sign-in did not return an ID token.',
		});
	}

	const claims = decodeJwt(token.idToken) as Record<string, unknown>;
	if ('groups' in claims) {
		assertMicrosoftGroupDecision(claims, roleMapping.mapping);
		return;
	}
	if (!hasMicrosoftGroupsOverage(claims)) {
		assertMicrosoftGroupDecision(claims, roleMapping.mapping);
		return;
	}
	if (!token.accessToken) {
		throwMicrosoftMembershipUnavailable();
	}

	let resolvedIds: string[];
	try {
		const { resolveMicrosoftGraphMemberships } = await import('./microsoft-user-group-membership.service');
		resolvedIds = await resolveMicrosoftGraphMemberships(token.accessToken, [...roleMapping.mapping.keys()]);
	} catch (error) {
		logger.warn('Could not verify Microsoft Entra group membership during sign-in', {
			source: 'system',
			context: { error: serializeError(error) },
		});
		throwMicrosoftMembershipUnavailable();
	}
	assertMicrosoftGroupDecision({ ...claims, groups: resolvedIds }, roleMapping.mapping);
}

function assertMicrosoftGroupDecision(
	claims: Record<string, unknown>,
	mapping: Map<string, 'admin' | 'user' | 'viewer'>,
): void {
	const decision = decideGroupOrganizationRoleMapping(claims, 'groups', mapping);
	if (decision.action === 'deny') {
		throw new APIError('FORBIDDEN', {
			message: 'Your account is not assigned to any nao access group.',
		});
	}
}

function throwMicrosoftMembershipUnavailable(): never {
	throw new APIError('FORBIDDEN', {
		message: 'Microsoft group membership could not be verified.',
	});
}

export function getTrustedProvidersForMicrosoft(): string[] {
	return ['microsoft'];
}

export function isSocialProviderMicrosoft(providerId: string | undefined): boolean {
	return providerId === 'microsoft';
}

export function isMicrosoftConfigured(): boolean {
	return azureAdEnv() !== null;
}

/**
 * Retrieves a Azure AD access token for a given user.
 * Uses the refresh token stored by better-auth during Microsoft sign-in
 * to silently acquire a new access token with the a specific audience scope.
 */
export async function getAzureAccessTokenForUser(userId: string): Promise<string | null> {
	const config = azureAdEnv();
	if (!config) {
		return null;
	}

	const rows = await db
		.select({
			refreshToken: s.account.refreshToken,
		})
		.from(s.account)
		.where(and(eq(s.account.userId, userId), eq(s.account.providerId, 'microsoft')))
		.limit(1);

	const refreshToken = rows[0]?.refreshToken;
	if (!refreshToken) {
		return null;
	}

	const tokenResponse = await fetch(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			client_id: config.clientId,
			client_secret: config.clientSecret,
			refresh_token: refreshToken,
			scope: config.tokenScope,
		}),
	});

	const data = await tokenResponse.json();

	if (data.error) {
		console.error(`[microsoft-auth] Failed to acquire token: ${data.error_description ?? data.error}`);
		return null;
	}

	return data.access_token ?? null;
}

function azureAdEnv(): AzureAdConfig | null {
	const { AZURE_AD_CLIENT_ID, AZURE_AD_CLIENT_SECRET, AZURE_AD_TENANT_ID, AZURE_AD_TOKEN_SCOPE } = env;

	if (!AZURE_AD_CLIENT_ID || !AZURE_AD_CLIENT_SECRET || !AZURE_AD_TENANT_ID) {
		return null;
	}

	return {
		clientId: AZURE_AD_CLIENT_ID,
		clientSecret: AZURE_AD_CLIENT_SECRET,
		tenantId: AZURE_AD_TENANT_ID,
		tokenScope: AZURE_AD_TOKEN_SCOPE || `${AZURE_AD_CLIENT_ID}/.default`,
	};
}
