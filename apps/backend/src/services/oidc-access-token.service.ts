/* @license Enterprise */

import { refreshAccessToken } from 'better-auth/oauth2';
import { and, eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import { env } from '../env';
import { logger, serializeError } from '../utils/logger';
import { memoizeUntilRejected } from '../utils/memoize-until-rejected';
import { getOidcProviderId, isOidcConfigured } from './oidc-auth.service';

/** Refreshed this early so the token outlives the warehouse queries of a long agent run. */
export const MIN_ACCESS_TOKEN_VALIDITY_MS = 5 * 60 * 1000;

interface OidcAccount {
	id: string;
	accessToken: string | null;
	accessTokenExpiresAt: Date | null;
	refreshToken: string | null;
}

const pendingRefreshes = new Map<string, Promise<string | null>>();

const tokenEndpoint = memoizeUntilRejected(fetchTokenEndpoint);

/**
 * Returns an access token from the user's OIDC sign-in, refreshing it with the stored refresh token
 * when it is about to expire. Providers such as Okta rotate refresh tokens, so the new one is saved.
 */
export async function getOidcAccessTokenForUser(userId: string): Promise<string | null> {
	if (!isOidcConfigured()) {
		return null;
	}
	const account = await findOidcAccount(userId);
	if (!account) {
		return null;
	}
	if (account.accessToken && isValidLongEnough(account.accessTokenExpiresAt)) {
		return account.accessToken;
	}
	if (!account.refreshToken) {
		return null;
	}
	return refreshOnce(account.id, account.refreshToken);
}

async function findOidcAccount(userId: string): Promise<OidcAccount | undefined> {
	const [account] = await db
		.select({
			id: s.account.id,
			accessToken: s.account.accessToken,
			accessTokenExpiresAt: s.account.accessTokenExpiresAt,
			refreshToken: s.account.refreshToken,
		})
		.from(s.account)
		.where(and(eq(s.account.userId, userId), eq(s.account.providerId, getOidcProviderId())))
		.limit(1);
	return account;
}

function isValidLongEnough(expiresAt: Date | null): boolean {
	return !expiresAt || expiresAt.getTime() - Date.now() > MIN_ACCESS_TOKEN_VALIDITY_MS;
}

/** Concurrent runs share one refresh: a rotated refresh token can only be redeemed once. */
function refreshOnce(accountId: string, refreshToken: string): Promise<string | null> {
	const pending = pendingRefreshes.get(accountId);
	if (pending) {
		return pending;
	}
	const refresh = refreshAndStore(accountId, refreshToken).finally(() => {
		pendingRefreshes.delete(accountId);
	});
	pendingRefreshes.set(accountId, refresh);
	return refresh;
}

async function refreshAndStore(accountId: string, refreshToken: string): Promise<string | null> {
	try {
		const tokens = await refreshAccessToken({
			refreshToken,
			options: { clientId: env.OIDC_CLIENT_ID, clientSecret: env.OIDC_CLIENT_SECRET },
			tokenEndpoint: await tokenEndpoint.get(),
		});
		if (!tokens.accessToken) {
			return null;
		}
		await db
			.update(s.account)
			.set({
				accessToken: tokens.accessToken,
				accessTokenExpiresAt: tokens.accessTokenExpiresAt ?? null,
				refreshToken: tokens.refreshToken ?? refreshToken,
			})
			.where(eq(s.account.id, accountId))
			.execute();
		return tokens.accessToken;
	} catch (error) {
		logger.warn('Could not refresh the OIDC access token', {
			source: 'system',
			context: { error: serializeError(error) },
		});
		return null;
	}
}

async function fetchTokenEndpoint(): Promise<string> {
	const response = await fetch(env.OIDC_DISCOVERY_URL!);
	if (!response.ok) {
		throw new Error(`OIDC discovery failed with status ${response.status}`);
	}
	const discovery = (await response.json()) as { token_endpoint?: string };
	if (!discovery.token_endpoint) {
		throw new Error('OIDC discovery document has no token_endpoint');
	}
	return discovery.token_endpoint;
}
