import { beforeEach, describe, expect, it, vi } from 'vitest';

import { McpOAuthProvider, type McpOAuthProviderOptions } from '../src/services/mcp-oauth-provider';

const mocks = vi.hoisted(() => ({
	getMcpOauthToken: vi.fn(),
	saveMcpOauthClientInfo: vi.fn(),
	saveMcpOauthTokens: vi.fn(),
}));

vi.mock('../src/queries/mcp-oauth.queries', () => ({
	getMcpOauthToken: mocks.getMcpOauthToken,
	saveMcpOauthClientInfo: mocks.saveMcpOauthClientInfo,
	saveMcpOauthTokens: mocks.saveMcpOauthTokens,
}));

const session = { userId: 'user-1', projectId: 'project-1', serverName: 'mixpanel' };
const redirectUri = 'https://nao.example.com/mcp/oauth/callback';

function makeProvider(overrides: Partial<McpOAuthProviderOptions> = {}): McpOAuthProvider {
	return new McpOAuthProvider({ session, config: {}, redirectUri, ...overrides });
}

describe('McpOAuthProvider', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getMcpOauthToken.mockResolvedValue(null);
	});

	describe('clientMetadata', () => {
		it('registers a public PKCE client when no secret is configured', () => {
			const metadata = makeProvider({ config: { scopes: ['read', 'write'] } }).clientMetadata;

			expect(metadata.redirect_uris).toEqual([redirectUri]);
			expect(metadata.token_endpoint_auth_method).toBe('none');
			expect(metadata.grant_types).toEqual(['authorization_code', 'refresh_token']);
			expect(metadata.response_types).toEqual(['code']);
			expect(metadata.scope).toBe('read write');
		});

		it('registers a confidential client and omits empty scopes', () => {
			const metadata = makeProvider({ config: { clientSecretEnv: 'SECRET_ENV', scopes: [] } }).clientMetadata;

			expect(metadata.token_endpoint_auth_method).toBe('client_secret_post');
			expect(metadata.scope).toBeUndefined();
		});
	});

	describe('clientInformation', () => {
		it('prefers a statically configured client and skips the DB', async () => {
			const provider = makeProvider({ config: { clientId: 'static-client' } });

			await expect(provider.clientInformation()).resolves.toEqual({
				client_id: 'static-client',
				client_secret: undefined,
			});
			expect(mocks.getMcpOauthToken).not.toHaveBeenCalled();
		});

		it('resolves a configured client secret from its env var', async () => {
			process.env.MCP_TEST_SECRET = 'shh';
			const provider = makeProvider({
				config: { clientId: 'static-client', clientSecretEnv: 'MCP_TEST_SECRET' },
			});

			await expect(provider.clientInformation()).resolves.toEqual({
				client_id: 'static-client',
				client_secret: 'shh',
			});
			delete process.env.MCP_TEST_SECRET;
		});

		it('throws when the configured client secret env var is missing', async () => {
			delete process.env.MCP_MISSING_SECRET;
			const provider = makeProvider({
				config: { clientId: 'static-client', clientSecretEnv: 'MCP_MISSING_SECRET' },
			});

			await expect(provider.clientInformation()).rejects.toThrow('MCP_MISSING_SECRET');
		});

		it('falls back to dynamically registered client info from the DB', async () => {
			mocks.getMcpOauthToken.mockResolvedValue({ clientInfo: { client_id: 'dcr-client' } });

			await expect(makeProvider().clientInformation()).resolves.toEqual({ client_id: 'dcr-client' });
		});

		it('returns undefined when no client is configured or registered', async () => {
			await expect(makeProvider().clientInformation()).resolves.toBeUndefined();
		});
	});

	describe('saveClientInformation', () => {
		it('persists only the client registration fields', async () => {
			await makeProvider().saveClientInformation({
				client_id: 'dcr-client',
				client_secret: 'dcr-secret',
				client_id_issued_at: 1700000000,
				client_secret_expires_at: 0,
				redirect_uris: [redirectUri],
			});

			expect(mocks.saveMcpOauthClientInfo).toHaveBeenCalledWith(session, {
				client_id: 'dcr-client',
				client_secret: 'dcr-secret',
				client_id_issued_at: 1700000000,
				client_secret_expires_at: 0,
			});
		});
	});

	describe('tokens', () => {
		it('returns undefined when there is no stored access token', async () => {
			mocks.getMcpOauthToken.mockResolvedValue({ accessToken: null });

			await expect(makeProvider().tokens()).resolves.toBeUndefined();
		});

		it('maps a stored row to OAuth tokens', async () => {
			const expiresAt = new Date(Date.now() + 3600 * 1000);
			mocks.getMcpOauthToken.mockResolvedValue({
				accessToken: 'access',
				refreshToken: 'refresh',
				scope: 'read',
				accessTokenExpiresAt: expiresAt,
			});

			const tokens = await makeProvider().tokens();

			expect(tokens?.access_token).toBe('access');
			expect(tokens?.token_type).toBe('Bearer');
			expect(tokens?.refresh_token).toBe('refresh');
			expect(tokens?.scope).toBe('read');
			expect(tokens?.expires_in).toBeGreaterThan(3500);
			expect(tokens?.expires_in).toBeLessThanOrEqual(3600);
		});
	});

	describe('saveTokens', () => {
		it('persists tokens and derives an absolute access-token expiry', async () => {
			const before = Date.now();
			await makeProvider().saveTokens({
				access_token: 'access',
				token_type: 'Bearer',
				refresh_token: 'refresh',
				scope: 'read',
				expires_in: 3600,
			});

			expect(mocks.saveMcpOauthTokens).toHaveBeenCalledTimes(1);
			const [keyArg, tokensArg] = mocks.saveMcpOauthTokens.mock.calls[0];
			expect(keyArg).toEqual(session);
			expect(tokensArg.accessToken).toBe('access');
			expect(tokensArg.refreshToken).toBe('refresh');
			expect(tokensArg.scope).toBe('read');
			expect(tokensArg.refreshTokenExpiresAt).toBeNull();
			expect(tokensArg.accessTokenExpiresAt.getTime()).toBeGreaterThanOrEqual(before + 3600 * 1000);
		});

		it('stores nulls when optional token fields are absent', async () => {
			await makeProvider().saveTokens({ access_token: 'access', token_type: 'Bearer' });

			const [, tokensArg] = mocks.saveMcpOauthTokens.mock.calls[0];
			expect(tokensArg.refreshToken).toBeNull();
			expect(tokensArg.accessTokenExpiresAt).toBeNull();
			expect(tokensArg.scope).toBeNull();
		});
	});

	describe('pkce and state', () => {
		it('returns a seeded code verifier and a captured authorization url', () => {
			const provider = makeProvider({ codeVerifier: 'seeded-verifier' });
			const url = new URL('https://auth.example.com/authorize?response_type=code');
			provider.redirectToAuthorization(url);

			expect(provider.codeVerifier()).toBe('seeded-verifier');
			expect(provider.authorizationUrl).toBe(url);
		});

		it('returns a code verifier saved during the connect leg', () => {
			const provider = makeProvider();
			provider.saveCodeVerifier('fresh-verifier');

			expect(provider.codeVerifier()).toBe('fresh-verifier');
		});

		it('throws when no code verifier is available', () => {
			expect(() => makeProvider().codeVerifier()).toThrow('code verifier');
		});

		it('uses a seeded state and keeps a generated one stable across calls', () => {
			expect(makeProvider({ state: 'seeded-state' }).state()).toBe('seeded-state');

			const generated = makeProvider();
			expect(generated.state()).toBe(generated.state());
		});
	});
});
