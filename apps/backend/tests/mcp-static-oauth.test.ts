import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { mcpJsonSchema } from '@nao/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
	providers: [] as OAuthClientProvider[],
	refreshCalls: [] as unknown[],
	registerClient: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/client/auth.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('@modelcontextprotocol/sdk/client/auth.js')>()),
	auth: async (provider: OAuthClientProvider) => {
		sdk.providers.push(provider);
		if (!(await provider.clientInformation())) {
			sdk.registerClient();
		}
		provider.redirectToAuthorization(new URL('https://provider.example/authorize'));
		return 'REDIRECT';
	},
	discoverOAuthServerInfo: async () => ({
		authorizationServerUrl: new URL('https://provider.example'),
		authorizationServerMetadata: undefined,
	}),
	refreshAuthorization: async (_url: URL, options: unknown) => {
		sdk.refreshCalls.push(options);
		return { access_token: 'fresh', token_type: 'Bearer', expires_in: 3600 };
	},
}));

vi.mock('../src/db/db', () => ({ db: {} }));

import * as queries from '../src/queries/mcp-oauth.queries';
import { resultPage } from '../src/routes/mcp-oauth';
import { buildAuthorizationRedirect, getValidAccessToken, MCP_OAUTH_CALLBACK_URL } from '../src/services/mcp-oauth';
import { encryptSecret } from '../src/utils/encryption';

const staticClient = { clientId: 'meta-app-id', clientSecret: 'meta-app-secret' };
const base = { projectId: 'project', userId: 'user', server: 'meta-ads', serverUrl: 'https://mcp.facebook.com/ads' };

beforeEach(() => {
	sdk.providers.length = 0;
	sdk.refreshCalls.length = 0;
	sdk.registerClient.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('mcp.json oauth block', () => {
	it('accepts a pre-registered client and rejects an empty client id', () => {
		const parsed = mcpJsonSchema.parse({
			mcpServers: {
				'meta-ads': {
					transport: 'streamable-http',
					url: 'https://mcp.facebook.com/ads',
					oauth: { clientId: 'meta-app-id' },
				},
			},
		});

		expect(parsed.mcpServers['meta-ads'].oauth).toEqual({ clientId: 'meta-app-id' });
		expect(() =>
			mcpJsonSchema.parse({
				mcpServers: { remote: { url: 'https://mcp.example.com', oauth: { clientId: '' } } },
			}),
		).toThrow();
	});
});

describe('static OAuth client', () => {
	it('skips dynamic client registration and uses the configured client', async () => {
		vi.spyOn(queries, 'getMcpOAuthClient').mockResolvedValue(null);
		const upsert = vi.spyOn(queries, 'upsertMcpOAuthClient').mockResolvedValue();

		const result = await buildAuthorizationRedirect({ ...base, signedState: 'state', staticClient });

		expect(result).toEqual({ status: 'redirect', url: 'https://provider.example/authorize' });
		expect(sdk.registerClient).not.toHaveBeenCalled();
		await expect(sdk.providers[0].clientInformation()).resolves.toEqual({
			client_id: 'meta-app-id',
			client_secret: 'meta-app-secret',
		});
		expect(upsert).toHaveBeenCalledWith('project', 'meta-ads', {
			clientId: 'meta-app-id',
			clientSecret: null,
			clientData: null,
		});
	});

	it('ignores a stale dynamically registered client once a static one is configured', async () => {
		vi.spyOn(queries, 'getMcpOAuthClient').mockResolvedValue({
			projectId: 'project',
			serverName: 'meta-ads',
			clientId: 'dcr-client',
			clientSecret: null,
			clientData: encryptSecret(JSON.stringify({ client_id: 'dcr-client' })),
			discoveryUserId: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		const upsert = vi.spyOn(queries, 'upsertMcpOAuthClient').mockResolvedValue();

		await buildAuthorizationRedirect({ ...base, signedState: 'state', staticClient });

		await expect(sdk.providers[0].clientInformation()).resolves.toMatchObject({ client_id: 'meta-app-id' });
		expect(upsert).toHaveBeenCalledWith(
			'project',
			'meta-ads',
			expect.objectContaining({ clientId: 'meta-app-id' }),
		);
	});

	it('still registers dynamically when no static client is configured', async () => {
		vi.spyOn(queries, 'getMcpOAuthClient').mockResolvedValue(null);

		await buildAuthorizationRedirect({ ...base, signedState: 'state' });

		expect(sdk.registerClient).toHaveBeenCalledOnce();
	});

	it('registers dynamically again once the static client is removed from mcp.json', async () => {
		vi.spyOn(queries, 'getMcpOAuthClient').mockResolvedValue({
			projectId: 'project',
			serverName: 'meta-ads',
			clientId: 'meta-app-id',
			clientSecret: null,
			clientData: null,
			discoveryUserId: 'user',
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		await buildAuthorizationRedirect({ ...base, signedState: 'state' });

		expect(sdk.registerClient).toHaveBeenCalledOnce();
	});

	it('refreshes expired tokens with the configured client', async () => {
		vi.spyOn(queries, 'getMcpUserToken').mockResolvedValue({
			userId: 'user',
			projectId: 'project',
			serverName: 'meta-ads',
			accessToken: encryptSecret('expired'),
			refreshToken: encryptSecret('refresh'),
			expiresAt: new Date(Date.now() - 1000),
			scope: null,
			codeVerifier: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		vi.spyOn(queries, 'getMcpOAuthClient').mockResolvedValue(null);
		vi.spyOn(queries, 'upsertMcpOAuthClient').mockResolvedValue();
		vi.spyOn(queries, 'saveMcpUserTokens').mockResolvedValue();

		const token = await getValidAccessToken({ ...base, staticClient });

		expect(token).toBe('fresh');
		expect(sdk.refreshCalls[0]).toMatchObject({
			clientInformation: { client_id: 'meta-app-id', client_secret: 'meta-app-secret' },
			refreshToken: 'refresh',
		});
	});
});

describe('OAuth popup result page', () => {
	it('shows the provider error, escaped, and keeps the popup open', () => {
		const html = resultPage('error', 'meta-ads', '/settings', 'invalid_client: <b>App ID</b> not found');

		expect(html).toContain('invalid_client: &lt;b&gt;App ID&lt;/b&gt; not found');
		expect(html).not.toContain('<b>App ID</b>');
		expect(html).toContain('"message":"invalid_client: \\u003cb>App ID\\u003c/b> not found"');
		expect(html).not.toMatch(
			/if \(window\.opener\) \{ window\.close\(\); \} else \{ window\.location\.href = "\/settings\?mcp=error"; \}\n/,
		);
	});

	it('closes the popup automatically on success', () => {
		const html = resultPage('connected', 'meta-ads', '/settings');

		expect(html).toContain('if (window.opener) { window.close(); }');
	});

	it('exposes the callback URL to whitelist on the provider app', () => {
		expect(MCP_OAUTH_CALLBACK_URL).toMatch(/\/api\/mcp-oauth\/callback$/);
	});
});
