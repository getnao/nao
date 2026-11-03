import { authorizationCodeRequest, getOAuth2Tokens, refreshAccessToken } from '@better-auth/core/oauth2';
import type { AuthContext, BetterAuthPlugin } from 'better-auth';

import { logger } from '../utils/logger';
import { githubOAuthUrl, isGithubEnterprise } from './github';

type SocialProvider = AuthContext['socialProviders'][number];

/**
 * better-auth's built-in GitHub provider hardcodes github.com endpoints, so on GitHub
 * Enterprise Server we repoint its OAuth endpoints at `GITHUB_BASE_URL` once auth initialises.
 */
export function augmentPluginsWithGithubEnterprise(plugins: BetterAuthPlugin[]): void {
	if (!isGithubEnterprise()) {
		return;
	}

	plugins.push({
		id: 'github-enterprise',
		init: (context) => {
			const provider = context.socialProviders.find((candidate) => candidate.id === 'github');
			if (provider) {
				pointProviderAtGithubEnterprise(provider);
			}
		},
	});
}

function pointProviderAtGithubEnterprise(provider: SocialProvider): void {
	const createGithubAuthorizationUrl = provider.createAuthorizationURL.bind(provider);
	const tokenEndpoint = `${githubOAuthUrl()}/access_token`;

	provider.createAuthorizationURL = async (data) => {
		const githubUrl = await createGithubAuthorizationUrl(data);
		const enterpriseUrl = new URL(`${githubOAuthUrl()}/authorize`);
		enterpriseUrl.search = githubUrl.search;
		return enterpriseUrl;
	};

	provider.validateAuthorizationCode = async ({ code, codeVerifier, redirectURI }) => {
		const { body, headers } = await authorizationCodeRequest({
			code,
			codeVerifier,
			redirectURI,
			options: provider.options ?? {},
		});
		return exchangeAuthorizationCode(tokenEndpoint, body, headers);
	};

	provider.refreshAccessToken = async (refreshToken) =>
		refreshAccessToken({ refreshToken, options: provider.options ?? {}, tokenEndpoint });
}

async function exchangeAuthorizationCode(tokenEndpoint: string, body: URLSearchParams, headers: HeadersInit) {
	const response = await fetch(tokenEndpoint, { method: 'POST', body, headers });
	const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
	if (!response.ok || !data || 'error' in data) {
		logger.error('GitHub Enterprise OAuth token exchange failed.', {
			source: 'system',
			context: { status: response.status, error: data?.error, description: data?.error_description },
		});
		return null;
	}
	return getOAuth2Tokens(data);
}
