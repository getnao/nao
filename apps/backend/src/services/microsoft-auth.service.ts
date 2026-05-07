/* @license Enterprise */

import type { BetterAuthOptions } from 'better-auth';
import { and, eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import { env } from '../env';

export type SocialProviders = NonNullable<BetterAuthOptions['socialProviders']>;

interface AzureAdConfig {
	clientId: string;
	clientSecret: string;
	tenantId: string;
}

export function augmentSocialProviders(providers: SocialProviders): void {
	const config = azureAdEnv();
	if (!config) {
		return;
	}
	providers.microsoft = {
		clientId: config.clientId,
		clientSecret: config.clientSecret,
		tenantId: config.tenantId,
	};
}

export function getTrustedProviders(): string[] {
	return ['microsoft'];
}

export function isSocialProvider(providerId: string | undefined): boolean {
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

	const scope = `api://${config.clientId}/.default`;

	const tokenResponse = await fetch(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			client_id: config.clientId,
			client_secret: config.clientSecret,
			refresh_token: refreshToken,
			scope,
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
	const { AZURE_AD_CLIENT_ID, AZURE_AD_CLIENT_SECRET, AZURE_AD_TENANT_ID } = env;

	if (!AZURE_AD_CLIENT_ID || !AZURE_AD_CLIENT_SECRET || !AZURE_AD_TENANT_ID) {
		return null;
	}

	return {
		clientId: AZURE_AD_CLIENT_ID,
		clientSecret: AZURE_AD_CLIENT_SECRET,
		tenantId: AZURE_AD_TENANT_ID,
	};
}
