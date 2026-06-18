import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	completeMcpOAuthFlow,
	McpOAuthError,
	mcpOAuthRedirectUri,
	startMcpOAuthFlow,
} from '../src/services/mcp-oauth.service';

const mocks = vi.hoisted(() => ({
	auth: vi.fn(),
	createMcpOauthFlow: vi.fn(),
	getMcpOauthFlow: vi.fn(),
	deleteMcpOauthFlow: vi.fn(),
	deleteExpiredMcpOauthFlows: vi.fn(),
	retrieveProjectById: vi.fn(),
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
	providerInstances: [] as Array<{ options: Record<string, unknown> }>,
	authorizationUrl: undefined as URL | undefined,
}));

vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({ auth: mocks.auth }));

vi.mock('../src/services/mcp-oauth-provider', () => ({
	McpOAuthProvider: class {
		options: Record<string, unknown>;
		constructor(options: Record<string, unknown>) {
			this.options = options;
			mocks.providerInstances.push(this);
		}
		state() {
			return (this.options.state as string) ?? 'generated-state';
		}
		codeVerifier() {
			return (this.options.codeVerifier as string) ?? 'generated-verifier';
		}
		get authorizationUrl() {
			return mocks.authorizationUrl;
		}
	},
}));

vi.mock('../src/queries/mcp-oauth-flow.queries', () => ({
	createMcpOauthFlow: mocks.createMcpOauthFlow,
	getMcpOauthFlow: mocks.getMcpOauthFlow,
	deleteMcpOauthFlow: mocks.deleteMcpOauthFlow,
	deleteExpiredMcpOauthFlows: mocks.deleteExpiredMcpOauthFlows,
}));

vi.mock('../src/queries/project.queries', () => ({ retrieveProjectById: mocks.retrieveProjectById }));
vi.mock('node:fs', () => ({ existsSync: mocks.existsSync, readFileSync: mocks.readFileSync }));
vi.mock('../src/utils/utils', () => ({ replaceEnvVars: (content: string) => content }));
vi.mock('../src/env', () => ({ env: { BETTER_AUTH_URL: 'https://nao.example.com/' } }));

const session = { userId: 'user-1', projectId: 'project-1', serverName: 'mixpanel' };

function configureServer(server: Record<string, unknown> | null = oauthServer()) {
	mocks.retrieveProjectById.mockResolvedValue({ path: '/projects/p1' });
	mocks.existsSync.mockReturnValue(true);
	const mcpServers = server ? { mixpanel: server } : {};
	mocks.readFileSync.mockReturnValue(JSON.stringify({ mcpServers }));
}

function oauthServer() {
	return {
		transport: 'streamable-http',
		url: 'https://mcp.example.com/mcp',
		oauth: { dynamicRegistration: true, scopes: ['read'] },
	};
}

describe('mcp-oauth.service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.providerInstances.length = 0;
		mocks.authorizationUrl = new URL('https://auth.example.com/authorize?x=1');
		mocks.auth.mockResolvedValue('REDIRECT');
	});

	describe('startMcpOAuthFlow', () => {
		it('persists a pending flow and returns the authorize URL', async () => {
			configureServer();

			const result = await startMcpOAuthFlow({ ...session, returnTo: '/settings/project/mcp-servers' });

			expect(result).toEqual({ status: 'redirect', authorizationUrl: 'https://auth.example.com/authorize?x=1' });
			expect(mocks.deleteExpiredMcpOauthFlows).toHaveBeenCalledTimes(1);
			expect(mocks.createMcpOauthFlow).toHaveBeenCalledTimes(1);
			const flow = mocks.createMcpOauthFlow.mock.calls[0][0];
			expect(flow).toMatchObject({
				state: 'generated-state',
				userId: 'user-1',
				projectId: 'project-1',
				serverName: 'mixpanel',
				codeVerifier: 'generated-verifier',
				returnTo: '/settings/project/mcp-servers',
			});
			expect(flow.expiresAt.getTime()).toBeGreaterThan(Date.now());
		});

		it('returns connected without persisting a flow when already authorized', async () => {
			configureServer();
			mocks.auth.mockResolvedValue('AUTHORIZED');

			await expect(startMcpOAuthFlow(session)).resolves.toEqual({ status: 'connected' });
			expect(mocks.createMcpOauthFlow).not.toHaveBeenCalled();
		});

		it.each([
			['//evil.com', null],
			['https://evil.com', null],
			['/valid/path', '/valid/path'],
			[undefined, null],
		])('normalizes returnTo %s to %s (open-redirect guard)', async (input, expected) => {
			configureServer();

			await startMcpOAuthFlow({ ...session, returnTo: input as string | undefined });

			expect(mocks.createMcpOauthFlow.mock.calls[0][0].returnTo).toBe(expected);
		});

		it('throws when the server is not configured', async () => {
			configureServer(null);

			await expect(startMcpOAuthFlow(session)).rejects.toBeInstanceOf(McpOAuthError);
		});

		it('throws when the server does not use OAuth', async () => {
			configureServer({ transport: 'streamable-http', url: 'https://mcp.example.com/mcp' });

			await expect(startMcpOAuthFlow(session)).rejects.toBeInstanceOf(McpOAuthError);
		});

		it('throws when no config file exists', async () => {
			mocks.retrieveProjectById.mockResolvedValue({ path: '/projects/p1' });
			mocks.existsSync.mockReturnValue(false);

			await expect(startMcpOAuthFlow(session)).rejects.toBeInstanceOf(McpOAuthError);
		});
	});

	describe('completeMcpOAuthFlow', () => {
		function storedFlow(overrides: Record<string, unknown> = {}) {
			return {
				state: 'state-1',
				userId: 'user-1',
				projectId: 'project-1',
				serverName: 'mixpanel',
				codeVerifier: 'verifier-1',
				returnTo: '/chat/42',
				expiresAt: new Date(Date.now() + 60_000),
				...overrides,
			};
		}

		it('exchanges the code, clears the flow, and returns its returnTo', async () => {
			configureServer();
			mocks.getMcpOauthFlow.mockResolvedValue(storedFlow());
			mocks.auth.mockResolvedValue('AUTHORIZED');

			const result = await completeMcpOAuthFlow({ state: 'state-1', code: 'auth-code', userId: 'user-1' });

			expect(result).toEqual({ returnTo: '/chat/42', serverName: 'mixpanel' });
			expect(mocks.auth).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ authorizationCode: 'auth-code' }),
			);
			expect(mocks.deleteMcpOauthFlow).toHaveBeenCalledWith('state-1');
			expect(mocks.providerInstances[0].options).toMatchObject({ state: 'state-1', codeVerifier: 'verifier-1' });
		});

		it('defaults returnTo when the flow stored none', async () => {
			configureServer();
			mocks.getMcpOauthFlow.mockResolvedValue(storedFlow({ returnTo: null }));
			mocks.auth.mockResolvedValue('AUTHORIZED');

			const result = await completeMcpOAuthFlow({ state: 'state-1', code: 'auth-code', userId: 'user-1' });

			expect(result.returnTo).toBe('/settings/project/mcp-servers');
		});

		it('throws when the flow is missing', async () => {
			mocks.getMcpOauthFlow.mockResolvedValue(null);

			await expect(
				completeMcpOAuthFlow({ state: 'unknown', code: 'auth-code', userId: 'user-1' }),
			).rejects.toBeInstanceOf(McpOAuthError);
			expect(mocks.auth).not.toHaveBeenCalled();
		});

		it('throws and clears an expired flow', async () => {
			mocks.getMcpOauthFlow.mockResolvedValue(storedFlow({ expiresAt: new Date(Date.now() - 1_000) }));

			await expect(
				completeMcpOAuthFlow({ state: 'state-1', code: 'auth-code', userId: 'user-1' }),
			).rejects.toBeInstanceOf(McpOAuthError);
			expect(mocks.deleteMcpOauthFlow).toHaveBeenCalledWith('state-1');
			expect(mocks.auth).not.toHaveBeenCalled();
		});

		it('throws when the flow belongs to another user', async () => {
			mocks.getMcpOauthFlow.mockResolvedValue(storedFlow({ userId: 'someone-else' }));

			await expect(
				completeMcpOAuthFlow({ state: 'state-1', code: 'auth-code', userId: 'user-1' }),
			).rejects.toBeInstanceOf(McpOAuthError);
			expect(mocks.auth).not.toHaveBeenCalled();
		});
	});

	describe('mcpOAuthRedirectUri', () => {
		it('builds the callback URL from the base URL without a double slash', () => {
			expect(mcpOAuthRedirectUri()).toBe('https://nao.example.com/api/mcp-oauth/callback');
		});
	});
});
