import { TRPCError } from '@trpc/server';

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

export type SharedGithubTokenStatus =
	| { configured: false }
	| { configured: true; account: SharedGithubAccount | null; error: string | null };

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
	const config = await contextRecommendationQueries.getConfig(projectId);
	if (!config?.encryptedGithubAccessToken) {
		return { configured: false };
	}
	const token = decryptStoredToken(config.encryptedGithubAccessToken, projectId);
	if (!token) {
		return {
			configured: true,
			account: null,
			error: 'The saved access token can no longer be read. Save it again.',
		};
	}
	try {
		return { configured: true, account: await readTokenAccount(token), error: null };
	} catch {
		return {
			configured: true,
			account: null,
			error: 'GitHub rejected the saved access token. It may have expired or been revoked.',
		};
	}
}

export async function saveSharedGithubToken(projectId: string, token: string): Promise<SharedGithubAccount> {
	const account = await readTokenAccount(token).catch(() => {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'GitHub rejected this access token.' });
	});
	await contextRecommendationQueries.updateConfig(projectId, { encryptedGithubAccessToken: encryptSecret(token) });
	return account;
}

export async function removeSharedGithubToken(projectId: string): Promise<void> {
	await contextRecommendationQueries.updateConfig(projectId, { encryptedGithubAccessToken: null });
}

export async function readSharedGithubToken(projectId: string): Promise<string | null> {
	const config = await contextRecommendationQueries.getConfig(projectId);
	return config?.encryptedGithubAccessToken ? decryptStoredToken(config.encryptedGithubAccessToken, projectId) : null;
}

async function readTokenAccount(token: string): Promise<SharedGithubAccount> {
	const user = await github.getUser(token);
	return { login: user.login, avatarUrl: user.avatar_url };
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
