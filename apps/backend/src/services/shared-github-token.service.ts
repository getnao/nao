import { TRPCError } from '@trpc/server';

import { env } from '../env';
import * as contextRecommendationQueries from '../queries/context-recommendation.queries';
import { decryptSecret, encryptSecret } from '../utils/encryption';
import { logger } from '../utils/logger';
import * as github from './github';
import {
	type InternalRepoProvider,
	REVIEW_REQUEST_PROVIDERS,
	type ReviewRequestProvider,
	withSharedAccessToken,
} from './review-request-provider';

export interface SharedGithubAccount {
	login: string;
	avatarUrl: string;
}

/** `environment` when GITHUB_ACCESS_TOKEN sets it on the server, which the settings cannot change. */
export type SharedGithubTokenSource = 'project' | 'environment';

export type SharedGithubTokenStatus =
	| { configured: false }
	| {
			configured: true;
			source: SharedGithubTokenSource;
			account: SharedGithubAccount | null;
			error: string | null;
	  };

const ENVIRONMENT_TOKEN_MESSAGE = 'The access token is set with GITHUB_ACCESS_TOKEN on the server.';

/** A project's shared GitHub token takes over from everyone's personal GitHub account. */
export async function resolveRepositoryProvider(
	projectId: string,
	providerName: InternalRepoProvider,
): Promise<ReviewRequestProvider> {
	const provider = REVIEW_REQUEST_PROVIDERS[providerName];
	if (providerName !== 'github') {
		return provider;
	}
	const sharedToken = await readSharedGithubToken(projectId);
	return sharedToken ? withSharedAccessToken(provider, sharedToken) : provider;
}

export async function resolveRepositoryToken(
	projectId: string,
	providerName: InternalRepoProvider,
	userId: string,
): Promise<string | null> {
	const provider = await resolveRepositoryProvider(projectId, providerName);
	return provider.getToken(userId);
}

export async function getSharedGithubTokenStatus(projectId: string): Promise<SharedGithubTokenStatus> {
	const environmentToken = readEnvironmentGithubToken();
	if (environmentToken) {
		return { configured: true, source: 'environment', ...(await checkTokenAccount(environmentToken)) };
	}
	const config = await contextRecommendationQueries.getConfig(projectId);
	if (!config?.encryptedGithubAccessToken) {
		return { configured: false };
	}
	const token = decryptStoredToken(config.encryptedGithubAccessToken, projectId);
	if (!token) {
		return {
			configured: true,
			source: 'project',
			account: null,
			error: 'The saved access token can no longer be read. Save it again.',
		};
	}
	return { configured: true, source: 'project', ...(await checkTokenAccount(token)) };
}

export async function saveSharedGithubToken(projectId: string, token: string): Promise<SharedGithubAccount> {
	assertTokenNotFromEnvironment();
	const account = await readTokenAccount(token).catch((error: unknown) => {
		throw isRejectedToken(error)
			? new TRPCError({ code: 'BAD_REQUEST', message: 'GitHub rejected this access token.' })
			: new TRPCError({
					code: 'INTERNAL_SERVER_ERROR',
					message: 'GitHub could not be reached to check this access token. Try again.',
					cause: error,
				});
	});
	await contextRecommendationQueries.updateConfig(projectId, { encryptedGithubAccessToken: encryptSecret(token) });
	return account;
}

export async function removeSharedGithubToken(projectId: string): Promise<void> {
	assertTokenNotFromEnvironment();
	await contextRecommendationQueries.updateConfig(projectId, { encryptedGithubAccessToken: null });
}

export async function readSharedGithubToken(projectId: string): Promise<string | null> {
	const environmentToken = readEnvironmentGithubToken();
	if (environmentToken) {
		return environmentToken;
	}
	const config = await contextRecommendationQueries.getConfig(projectId);
	return config?.encryptedGithubAccessToken ? decryptStoredToken(config.encryptedGithubAccessToken, projectId) : null;
}

/** nao Cloud ignores the server token, as its projects belong to different organizations. */
function readEnvironmentGithubToken(): string | null {
	return env.NAO_MODE === 'cloud' ? null : (env.GITHUB_ACCESS_TOKEN ?? null);
}

function assertTokenNotFromEnvironment(): void {
	if (readEnvironmentGithubToken()) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: ENVIRONMENT_TOKEN_MESSAGE });
	}
}

async function checkTokenAccount(
	token: string,
): Promise<{ account: SharedGithubAccount | null; error: string | null }> {
	try {
		return { account: await readTokenAccount(token), error: null };
	} catch (error) {
		return {
			account: null,
			error: isRejectedToken(error)
				? 'GitHub rejected the access token. It may have expired or been revoked.'
				: 'GitHub could not be reached to check the access token.',
		};
	}
}

async function readTokenAccount(token: string): Promise<SharedGithubAccount> {
	const user = await github.getUser(token);
	return { login: user.login, avatarUrl: user.avatar_url };
}

function isRejectedToken(error: unknown): boolean {
	return error instanceof github.GithubApiError && (error.status === 401 || error.status === 403);
}

/** Null when the app secret changed since the token was saved, for nao to fall back to personal accounts. */
function decryptStoredToken(encryptedToken: string, projectId: string): string | null {
	try {
		return decryptSecret(encryptedToken);
	} catch {
		logger.warn(`The shared GitHub access token of project ${projectId} cannot be decrypted.`, {
			source: 'system',
		});
		return null;
	}
}
