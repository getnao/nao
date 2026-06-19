import { count } from 'drizzle-orm';

import { env } from '../env';
import { isGithubSsoEnabled } from './github';
import { getLicense } from './license.service';
import { LICENSES_STARTUP_PING_URL } from './license-endpoints';
import { isOidcConfigured } from './oidc-auth.service';

const STARTUP_PING_TIMEOUT_MS = 3_000;

export async function pingLicensesServer(): Promise<void> {
	if (env.MODE !== 'prod') {
		return;
	}
	const license = await getLicense();
	if (license?.isOffline) {
		return;
	}

	try {
		const response = await fetch(LICENSES_STARTUP_PING_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				betterAuthUrl: env.BETTER_AUTH_URL,
				naoVersion: env.APP_VERSION,
				additionalInfo: await startupAdditionalInfo(),
			}),
			signal: AbortSignal.timeout(STARTUP_PING_TIMEOUT_MS),
		});

		if (!response.ok) {
			console.warn(`[license] Startup ping failed with status ${response.status}`);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.warn(`[license] Startup ping failed: ${message}`);
	}
}

interface StartupAdditionalInfo {
	userCount: number | null;
	betaAutomationsEnabled: boolean;
	betaContextRecommendationsEnabled: boolean;
	smtpConfigured: boolean;
	loginModesConfigured: {
		google: boolean;
		github: boolean;
		azure: boolean;
		oidc: boolean;
	};
}

async function startupAdditionalInfo(): Promise<StartupAdditionalInfo> {
	const [userCount, googleConfigured] = await Promise.all([getUserCount(), isGoogleConfigured()]);

	return {
		userCount,
		betaAutomationsEnabled: env.BETA_AUTOMATIONS_ENABLED,
		betaContextRecommendationsEnabled: env.BETA_CONTEXT_RECOMMENDATIONS_ENABLED,
		smtpConfigured: isSmtpConfigured(),
		loginModesConfigured: {
			google: googleConfigured,
			github: isGithubSsoEnabled(),
			azure: isAzureConfigured(),
			oidc: isOidcConfigured(),
		},
	};
}

async function getUserCount(): Promise<number | null> {
	try {
		const [{ db }, { default: s }] = await Promise.all([import('../db/db'), import('../db/abstractSchema')]);
		const rows = await db.select({ count: count() }).from(s.user);
		return rows[0]?.count ?? 0;
	} catch {
		return null;
	}
}

async function isGoogleConfigured(): Promise<boolean> {
	if (env.NAO_MODE === 'cloud') {
		return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
	}

	try {
		const orgQueries = await import('../queries/organization.queries');
		const config = await orgQueries.getGoogleConfig();
		return Boolean(config.clientId && config.clientSecret);
	} catch {
		return false;
	}
}

function isSmtpConfigured(): boolean {
	return Boolean(env.SMTP_HOST && env.SMTP_MAIL_FROM && env.SMTP_PASSWORD);
}

function isAzureConfigured(): boolean {
	return Boolean(env.AZURE_AD_CLIENT_ID && env.AZURE_AD_CLIENT_SECRET && env.AZURE_AD_TENANT_ID);
}
