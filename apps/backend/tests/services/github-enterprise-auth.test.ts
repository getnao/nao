import { github } from '@better-auth/core/social-providers';
import type { AuthContext, BetterAuthPlugin } from 'better-auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv: Record<string, unknown> = {};

vi.mock('../../src/env', () => ({
	get env() {
		return mockEnv;
	},
}));

async function initGithubProvider() {
	vi.resetModules();
	const { augmentPluginsWithGithubEnterprise } = await import('../../src/services/github-enterprise-auth.service');
	const provider = github({ clientId: 'client-id', clientSecret: 'client-secret' });
	const plugins: BetterAuthPlugin[] = [];
	augmentPluginsWithGithubEnterprise(plugins);
	await plugins[0]?.init?.({ socialProviders: [provider] } as unknown as AuthContext);
	return { provider, plugins };
}

describe('augmentPluginsWithGithubEnterprise', () => {
	beforeEach(() => {
		Object.keys(mockEnv).forEach((key) => delete mockEnv[key]);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('leaves the github.com provider untouched without GITHUB_BASE_URL', async () => {
		const { plugins } = await initGithubProvider();

		expect(plugins).toHaveLength(0);
	});

	it('sends the authorization step to the enterprise host', async () => {
		mockEnv.GITHUB_BASE_URL = 'https://ghe.example.com';
		const { provider } = await initGithubProvider();

		const url = await provider.createAuthorizationURL({
			state: 'state',
			codeVerifier: 'verifier',
			redirectURI: 'https://nao.example.com/api/auth/callback/github',
		});

		expect(url.origin).toBe('https://ghe.example.com');
		expect(url.pathname).toBe('/login/oauth/authorize');
		expect(url.searchParams.get('client_id')).toBe('client-id');
		expect(url.searchParams.get('state')).toBe('state');
	});

	it('exchanges the authorization code on the enterprise host', async () => {
		mockEnv.GITHUB_BASE_URL = 'https://ghe.example.com';
		const fetchMock = vi.fn(async () => Response.json({ access_token: 'token', token_type: 'bearer' }));
		vi.stubGlobal('fetch', fetchMock);
		const { provider } = await initGithubProvider();

		const tokens = await provider.validateAuthorizationCode({
			code: 'code',
			redirectURI: 'https://nao.example.com/api/auth/callback/github',
		});

		expect(fetchMock).toHaveBeenCalledWith('https://ghe.example.com/login/oauth/access_token', expect.anything());
		const requestBody = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
		expect(requestBody.get('client_id')).toBe('client-id');
		expect(requestBody.get('client_secret')).toBe('client-secret');
		expect(tokens?.accessToken).toBe('token');
	});

	it('returns no tokens when the enterprise host rejects the code', async () => {
		mockEnv.GITHUB_BASE_URL = 'https://ghe.example.com';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ error: 'bad_verification_code' })),
		);
		const { provider } = await initGithubProvider();

		const tokens = await provider.validateAuthorizationCode({
			code: 'code',
			redirectURI: 'https://nao.example.com/api/auth/callback/github',
		});

		expect(tokens).toBeNull();
	});
});
