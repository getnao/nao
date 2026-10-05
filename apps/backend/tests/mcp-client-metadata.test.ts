import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	baseUrl: 'https://nao.example/',
	clientId: null as string | null,
	cimdSupported: true,
	cimdEnabled: true,
}));

vi.mock('../src/env', () => ({
	env: {
		get BETTER_AUTH_URL() {
			return state.baseUrl;
		},
		BETTER_AUTH_SECRET: 'test-client-metadata-secret',
		get MCP_CLIENT_METADATA_ENABLED() {
			return state.cimdEnabled;
		},
	},
}));
vi.mock('../src/queries/mcp-oauth.queries', () => ({
	getMcpOAuthClient: async () => (state.clientId ? { clientId: state.clientId } : null),
	getMcpUserToken: async () => null,
	saveMcpCodeVerifier: async () => undefined,
	upsertMcpOAuthClient: async (_project: string, _server: string, info: { clientId: string }) => {
		state.clientId = info.clientId;
	},
}));
vi.mock('../src/queries/project.queries', () => ({}));
vi.mock('../src/auth', () => ({ getSession: async () => null }));
vi.mock('../src/services/mcp', () => ({ mcpService: {} }));
vi.mock('../src/utils/logger', () => ({ logger: { error: () => undefined } }));

const authorize = async (): Promise<URL> => {
	const { buildAuthorizationRedirect } = await import('../src/services/mcp-oauth');
	const result = await buildAuthorizationRedirect({
		projectId: 'project',
		userId: 'user',
		server: 'retrocast',
		serverUrl: 'https://forecast.example/mcp',
		signedState: 'signed-state',
	});
	if (result.status !== 'redirect') {
		throw new Error('Expected an authorization redirect');
	}
	return new URL(result.url);
};

describe('MCP OAuth client metadata documents', () => {
	beforeEach(() => {
		vi.resetModules();
		state.baseUrl = 'https://nao.example/';
		state.clientId = null;
		state.cimdSupported = true;
		state.cimdEnabled = true;
		vi.stubGlobal('fetch', async (input: string | URL | Request): Promise<Response> => {
			const url = input instanceof Request ? input.url : String(input);
			if (url.includes('oauth-protected-resource')) {
				return Response.json({
					resource: 'https://forecast.example/mcp',
					authorization_servers: ['https://auth.example'],
					scopes_supported: ['openid', 'offline_access'],
				});
			}
			if (url.includes('oauth-authorization-server')) {
				return Response.json({
					issuer: 'https://auth.example',
					authorization_endpoint: 'https://auth.example/authorize',
					token_endpoint: 'https://auth.example/token',
					response_types_supported: ['code'],
					code_challenge_methods_supported: ['S256'],
					client_id_metadata_document_supported: state.cimdSupported,
					...((!state.cimdSupported || !state.cimdEnabled) && {
						registration_endpoint: 'https://auth.example/register',
					}),
				});
			}
			if (url === 'https://auth.example/register') {
				return Response.json({
					client_id: 'dynamic-client',
					redirect_uris: ['https://nao.example/api/mcp-oauth/callback'],
					grant_types: ['authorization_code', 'refresh_token'],
					response_types: ['code'],
					token_endpoint_auth_method: 'none',
				});
			}
			throw new Error(`Unexpected OAuth request: ${url}`);
		});
	});

	afterEach(() => vi.unstubAllGlobals());

	it('authorizes with a URL client ID when the server has no registration endpoint', async () => {
		const url = await authorize();
		expect(url.origin).toBe('https://auth.example');
		expect(url.searchParams.get('client_id')).toBe('https://nao.example/api/mcp-oauth/client-metadata.json');
		expect(url.searchParams.get('redirect_uri')).toBe('https://nao.example/api/mcp-oauth/callback');
		expect(url.searchParams.get('code_challenge_method')).toBe('S256');
		expect(url.searchParams.get('state')).toBe('signed-state');
		expect(state.clientId).toBe('https://nao.example/api/mcp-oauth/client-metadata.json');
	});

	it('keeps an existing registered client ID', async () => {
		state.clientId = 'registered-client';
		expect((await authorize()).searchParams.get('client_id')).toBe('registered-client');
	});

	it('still dynamically registers with servers that do not support metadata documents', async () => {
		state.cimdSupported = false;
		expect((await authorize()).searchParams.get('client_id')).toBe('dynamic-client');
		expect(state.clientId).toBe('dynamic-client');
	});

	it('does not advertise an HTTP localhost metadata document', async () => {
		state.baseUrl = 'http://localhost:5005/';
		await expect(authorize()).rejects.toThrow(/does not support dynamic client registration/);
	});

	it('preserves dynamic registration on private HTTPS deployments unless metadata is enabled', async () => {
		state.cimdEnabled = false;
		expect((await authorize()).searchParams.get('client_id')).toBe('dynamic-client');
	});

	it('serves the matching public metadata without requiring a user session', async () => {
		const { mcpOAuthRoutes } = await import('../src/routes/mcp-oauth');
		const app = Fastify();
		await app.register(mcpOAuthRoutes, { prefix: '/api/mcp-oauth' });
		try {
			const response = await app.inject('/api/mcp-oauth/client-metadata.json');
			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({
				client_id: 'https://nao.example/api/mcp-oauth/client-metadata.json',
				client_name: 'nao',
				redirect_uris: ['https://nao.example/api/mcp-oauth/callback'],
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code'],
				token_endpoint_auth_method: 'none',
			});
		} finally {
			await app.close();
		}
	});
});
