import { count, eq, type SQL, sql } from 'drizzle-orm';
import type { AnySQLiteColumn, AnySQLiteTable } from 'drizzle-orm/sqlite-core';

import { getConnections } from '../agents/user-rules';
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
	messageCount: number | null;
	storyCount: number | null;
	tokenCounts: TokenCounts | null;
	betaAutomationsEnabled: boolean;
	betaContextRecommendationsEnabled: boolean;
	betaStoryFiltersEnabled: boolean;
	betaSubagentsEnabled: boolean;
	smtpConfigured: boolean;
	loginModesConfigured: {
		google: boolean;
		github: boolean;
		azure: boolean;
		oidc: boolean;
	};
	databaseTypes: string[];
}

interface TokenCounts {
	input: number;
	cacheRead: number;
	cacheWrite: number;
	output: number;
}

async function startupAdditionalInfo(): Promise<StartupAdditionalInfo> {
	const [userCount, messageCount, storyCount, tokenCounts, googleConfigured, databaseTypes] = await Promise.all([
		getUserCount(),
		getMessageCount(),
		getStoryCount(),
		getTokenCounts(),
		isGoogleConfigured(),
		getDatabaseTypes(),
	]);

	return {
		userCount,
		messageCount,
		storyCount,
		tokenCounts,
		betaAutomationsEnabled: env.BETA_AUTOMATIONS_ENABLED,
		betaContextRecommendationsEnabled: env.BETA_CONTEXT_RECOMMENDATIONS_ENABLED,
		betaStoryFiltersEnabled: env.BETA_STORY_FILTERS_ENABLED,
		betaSubagentsEnabled: env.BETA_SUBAGENTS_ENABLED,
		smtpConfigured: isSmtpConfigured(),
		loginModesConfigured: {
			google: googleConfigured,
			github: isGithubSsoEnabled(),
			azure: isAzureConfigured(),
			oidc: isOidcConfigured(),
		},
		databaseTypes,
	};
}

async function getDatabaseTypes(): Promise<string[]> {
	try {
		const projectQueries = await import('../queries/project.queries');
		const project = await projectQueries.getDefaultProject();
		if (!project?.path) {
			return [];
		}

		const connections = getConnections(project.path);
		if (!connections) {
			return [];
		}

		return [...new Set(connections.map((connection) => connection.type))];
	} catch {
		return [];
	}
}

function getUserCount(): Promise<number | null> {
	return countRows((s) => s.user);
}

function getStoryCount(): Promise<number | null> {
	return countRows((s) => s.story);
}

function getMessageCount(): Promise<number | null> {
	return countRows(
		(s) => s.chatMessage,
		(s) => eq(s.chatMessage.role, 'user'),
	);
}

async function getTokenCounts(): Promise<TokenCounts | null> {
	try {
		const [{ db }, { default: s }] = await Promise.all([import('../db/db'), import('../db/abstractSchema')]);
		const m = s.chatMessage;
		const [row] = await db
			.select({
				input: sumColumn(m.inputNoCacheTokens),
				cacheRead: sumColumn(m.inputCacheReadTokens),
				cacheWrite: sumColumn(m.inputCacheWriteTokens),
				output: sumColumn(m.outputTotalTokens),
			})
			.from(m);
		return row ?? { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
	} catch {
		return null;
	}
}

function sumColumn(column: AnySQLiteColumn): SQL<number> {
	return sql<number>`coalesce(sum(${column}), 0)`.mapWith(Number);
}

type Schema = typeof import('../db/abstractSchema').default;

async function countRows(
	selectTable: (s: Schema) => AnySQLiteTable,
	buildWhere?: (s: Schema) => SQL,
): Promise<number | null> {
	try {
		const [{ db }, { default: s }] = await Promise.all([import('../db/db'), import('../db/abstractSchema')]);
		const query = db.select({ count: count() }).from(selectTable(s));
		const rows = buildWhere ? await query.where(buildWhere(s)) : await query;
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
