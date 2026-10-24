import {
	auth,
	discoverOAuthProtectedResourceMetadata,
	discoverOAuthServerInfo,
	type OAuthClientProvider,
	refreshAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
	OAuthClientInformationMixed,
	OAuthClientMetadata,
	OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpOAuthClientConfig } from '@nao/shared';

import type { DBMcpOAuthClient } from '../db/abstractSchema';
import { env, isCloud } from '../env';
import {
	deleteMcpUserToken,
	getMcpOAuthClient,
	getMcpUserToken,
	saveMcpCodeVerifier,
	saveMcpUserTokens,
	upsertMcpOAuthClient,
} from '../queries/mcp-oauth.queries';
import { decryptSecret, encryptSecret } from '../utils/encryption';
import { logger } from '../utils/logger';
import { privateNetworkGuardedFetch } from '../utils/safe-fetch';

/**
 * The fetch every MCP request goes through. A self-hosted admin may point at an internal server
 * (they can already run stdio servers), but a cloud tenant must never reach the shared network.
 */
export const mcpFetch: FetchLike | undefined = isCloud ? privateNetworkGuardedFetch : undefined;

const BASE_URL = env.BETTER_AUTH_URL.replace(/\/+$/, '');
/** Redirect URI to whitelist on a provider app when using a pre-registered OAuth client. */
export const MCP_OAUTH_CALLBACK_URL = `${BASE_URL}/api/mcp-oauth/callback`;
const TOKEN_EXPIRY_BUFFER_MS = 60_000;

/** Thrown when a per-user MCP OAuth token is missing/invalid and the user must (re)connect. */
export class McpAuthRequiredError extends Error {
	constructor(public readonly server: string) {
		super(`MCP server "${server}" requires the user to connect their account.`);
		this.name = 'McpAuthRequiredError';
	}
}

interface ProviderOptions {
	projectId: string;
	userId: string;
	server: string;
	signedState: string;
	staticClient?: McpOAuthClientConfig;
}

/** Returns true if the MCP server advertises OAuth protected-resource metadata (RFC 9728). */
export async function isOAuthServer(serverUrl: string): Promise<boolean> {
	try {
		const metadata = await discoverOAuthProtectedResourceMetadata(serverUrl, undefined, mcpFetch);
		return !!metadata;
	} catch {
		return false;
	}
}

/** Heuristic for whether an MCP connection error is an OAuth/authorization failure. */
export function isUnauthorizedError(error: unknown): boolean {
	const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
	return (
		message.includes('401') ||
		message.includes('unauthorized') ||
		message.includes('invalid_token') ||
		message.includes('www-authenticate')
	);
}

/**
 * Returns a valid access token for the user/server, refreshing it if expired.
 * Returns null when the user has no usable token and must (re)authorize.
 */
export async function getValidAccessToken(opts: {
	userId: string;
	projectId: string;
	server: string;
	serverUrl: string;
	staticClient?: McpOAuthClientConfig;
}): Promise<string | null> {
	const row = await getMcpUserToken(opts.userId, opts.projectId, opts.server);
	if (!row?.accessToken) {
		return null;
	}

	const accessToken = decryptSecret(row.accessToken);
	const stillValid = !row.expiresAt || row.expiresAt.getTime() - Date.now() > TOKEN_EXPIRY_BUFFER_MS;
	if (stillValid) {
		return accessToken;
	}
	if (!row.refreshToken) {
		return null;
	}

	try {
		const info = await discoverOAuthServerInfo(opts.serverUrl, { fetchFn: mcpFetch });
		const clientInformation = await resolveClientInformation(opts.projectId, opts.server, opts.staticClient);
		if (!clientInformation) {
			return null;
		}
		const tokens = await refreshAuthorization(info.authorizationServerUrl, {
			metadata: info.authorizationServerMetadata,
			clientInformation,
			refreshToken: decryptSecret(row.refreshToken),
			fetchFn: mcpFetch,
		});
		await persistTokens(opts.userId, opts.projectId, opts.server, tokens);
		return tokens.access_token;
	} catch (error) {
		logger.error(`MCP OAuth refresh failed: ${opts.server}`, {
			source: 'tool',
			projectId: opts.projectId,
			context: { server: opts.server, error: String(error) },
		});
		await deleteMcpUserToken(opts.userId, opts.projectId, opts.server);
		return null;
	}
}

/** Starts the authorization-code flow, returning the provider authorization URL to redirect to. */
export async function buildAuthorizationRedirect(opts: {
	projectId: string;
	userId: string;
	server: string;
	serverUrl: string;
	signedState: string;
	staticClient?: McpOAuthClientConfig;
}): Promise<{ status: 'redirect'; url: string } | { status: 'authorized' }> {
	const provider = new DbOAuthClientProvider(opts);
	const result = await auth(provider, { serverUrl: opts.serverUrl, fetchFn: mcpFetch });
	if (result === 'AUTHORIZED') {
		return { status: 'authorized' };
	}
	if (provider.authorizationUrl) {
		return { status: 'redirect', url: provider.authorizationUrl.toString() };
	}
	throw new Error('Failed to build MCP authorization URL');
}

/** Completes the authorization-code flow by exchanging the code for tokens. */
export async function completeAuthorization(opts: {
	projectId: string;
	userId: string;
	server: string;
	serverUrl: string;
	signedState: string;
	code: string;
	staticClient?: McpOAuthClientConfig;
}): Promise<void> {
	const provider = new DbOAuthClientProvider(opts);
	const result = await auth(provider, { serverUrl: opts.serverUrl, authorizationCode: opts.code, fetchFn: mcpFetch });
	if (result !== 'AUTHORIZED') {
		throw new Error('MCP authorization did not complete');
	}
}

async function persistTokens(userId: string, projectId: string, server: string, tokens: OAuthTokens): Promise<void> {
	await saveMcpUserTokens(userId, projectId, server, {
		accessToken: encryptSecret(tokens.access_token),
		refreshToken: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
		expiresAt: tokens.expires_in !== undefined ? new Date(Date.now() + tokens.expires_in * 1000) : null,
		scope: tokens.scope ?? null,
	});
}

/**
 * A static client configured in `mcp.json` always wins over a dynamically registered one, so
 * switching a server from DCR to a pre-registered client never reuses the stale registration.
 */
async function resolveClientInformation(
	projectId: string,
	server: string,
	staticClient?: McpOAuthClientConfig,
): Promise<OAuthClientInformationMixed | undefined> {
	if (staticClient) {
		await ensureStaticClientRecord(projectId, server, staticClient);
		return clientInformationFromConfig(staticClient);
	}
	const row = await getMcpOAuthClient(projectId, server);
	return row && isDynamicallyRegistered(row) ? clientInformationFromRow(row) : undefined;
}

function isDynamicallyRegistered(row: DBMcpOAuthClient): boolean {
	return !!row.clientData;
}

async function ensureStaticClientRecord(
	projectId: string,
	server: string,
	staticClient: McpOAuthClientConfig,
): Promise<void> {
	const row = await getMcpOAuthClient(projectId, server);
	if (row?.clientId === staticClient.clientId && !row.clientSecret && !row.clientData) {
		return;
	}
	await upsertMcpOAuthClient(projectId, server, {
		clientId: staticClient.clientId,
		clientSecret: null,
		clientData: null,
	});
}

function clientInformationFromConfig(staticClient: McpOAuthClientConfig): OAuthClientInformationMixed {
	return { client_id: staticClient.clientId, client_secret: staticClient.clientSecret };
}

function clientInformationFromRow(row: DBMcpOAuthClient): OAuthClientInformationMixed {
	if (row.clientData) {
		try {
			return JSON.parse(decryptSecret(row.clientData)) as OAuthClientInformationMixed;
		} catch {
			// Fall back to the discrete columns below
		}
	}
	return {
		client_id: row.clientId,
		client_secret: row.clientSecret ? decryptSecret(row.clientSecret) : undefined,
	};
}

/**
 * OAuth client provider backed by nao's database. A provider instance is scoped to a single
 * (user, project, server) "session"; tokens never cross users.
 */
class DbOAuthClientProvider implements OAuthClientProvider {
	authorizationUrl?: URL;

	constructor(private readonly opts: ProviderOptions) {}

	get redirectUrl(): string {
		return MCP_OAUTH_CALLBACK_URL;
	}

	get clientMetadata(): OAuthClientMetadata {
		return {
			client_name: 'nao',
			redirect_uris: [MCP_OAUTH_CALLBACK_URL],
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none',
		};
	}

	state(): string {
		return this.opts.signedState;
	}

	async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
		return resolveClientInformation(this.opts.projectId, this.opts.server, this.opts.staticClient);
	}

	async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
		await upsertMcpOAuthClient(this.opts.projectId, this.opts.server, {
			clientId: info.client_id,
			clientSecret: info.client_secret ? encryptSecret(info.client_secret) : null,
			clientData: encryptSecret(JSON.stringify(info)),
		});
	}

	async tokens(): Promise<OAuthTokens | undefined> {
		const row = await getMcpUserToken(this.opts.userId, this.opts.projectId, this.opts.server);
		if (!row?.accessToken) {
			return undefined;
		}
		return {
			access_token: decryptSecret(row.accessToken),
			token_type: 'Bearer',
			refresh_token: row.refreshToken ? decryptSecret(row.refreshToken) : undefined,
			scope: row.scope ?? undefined,
			expires_in: row.expiresAt
				? Math.max(0, Math.floor((row.expiresAt.getTime() - Date.now()) / 1000))
				: undefined,
		};
	}

	async saveTokens(tokens: OAuthTokens): Promise<void> {
		await persistTokens(this.opts.userId, this.opts.projectId, this.opts.server, tokens);
	}

	redirectToAuthorization(authorizationUrl: URL): void {
		this.authorizationUrl = authorizationUrl;
	}

	async saveCodeVerifier(codeVerifier: string): Promise<void> {
		await saveMcpCodeVerifier(this.opts.userId, this.opts.projectId, this.opts.server, encryptSecret(codeVerifier));
	}

	async codeVerifier(): Promise<string> {
		const row = await getMcpUserToken(this.opts.userId, this.opts.projectId, this.opts.server);
		if (!row?.codeVerifier) {
			throw new Error('Missing PKCE code verifier for MCP authorization');
		}
		return decryptSecret(row.codeVerifier);
	}

	async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
		if (scope === 'tokens' || scope === 'all') {
			await deleteMcpUserToken(this.opts.userId, this.opts.projectId, this.opts.server);
		}
	}
}
