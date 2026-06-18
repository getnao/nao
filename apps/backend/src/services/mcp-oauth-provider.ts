import { randomUUID } from 'node:crypto';

import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
	OAuthClientInformationMixed,
	OAuthClientMetadata,
	OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { McpOAuthConfig } from '@nao/shared';

import { getMcpOauthToken, saveMcpOauthClientInfo, saveMcpOauthTokens } from '../queries/mcp-oauth.queries';
import type { McpOAuthClientInfo } from '../types/mcp-oauth';

/** Identifies the per-user authorization session a provider instance is bound to. */
export interface McpOAuthSession {
	userId: string;
	projectId: string;
	serverName: string;
}

export interface McpOAuthProviderOptions {
	session: McpOAuthSession;
	config: McpOAuthConfig;
	/** Public web callback the authorization server redirects back to (not a loopback). */
	redirectUri: string;
	/** Seeds the CSRF state when resuming a flow in the callback leg; generated otherwise. */
	state?: string;
	/** Seeds the PKCE verifier captured during the connect leg so the callback can exchange the code. */
	codeVerifier?: string;
}

/**
 * DB-backed {@link OAuthClientProvider} for a single remote MCP server, scoped to one
 * `(userId, projectId, serverName)` session. Durable credentials (tokens + dynamically
 * registered client info) live in the `mcp_oauth_token` table; the transient per-flow
 * `state` and PKCE verifier are held in memory and exposed for the web routes to persist
 * across the redirect→callback boundary.
 */
export class McpOAuthProvider implements OAuthClientProvider {
	private readonly session: McpOAuthSession;
	private readonly config: McpOAuthConfig;
	private readonly _redirectUrl: string;
	private readonly _state: string;
	private _codeVerifier?: string;
	private _authorizationUrl?: URL;

	constructor(options: McpOAuthProviderOptions) {
		this.session = options.session;
		this.config = options.config;
		this._redirectUrl = options.redirectUri;
		this._state = options.state ?? randomUUID();
		this._codeVerifier = options.codeVerifier;
	}

	get redirectUrl(): string {
		return this._redirectUrl;
	}

	get clientMetadata(): OAuthClientMetadata {
		const scope = this.config.scopes?.length ? this.config.scopes.join(' ') : undefined;
		return {
			client_name: 'nao',
			redirect_uris: [this._redirectUrl],
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: this.config.clientSecretEnv ? 'client_secret_post' : 'none',
			scope,
		};
	}

	/** Authorization URL captured during {@link redirectToAuthorization}, for the connect route to surface. */
	get authorizationUrl(): URL | undefined {
		return this._authorizationUrl;
	}

	state(): string {
		return this._state;
	}

	async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
		if (this.config.clientId) {
			return { client_id: this.config.clientId, client_secret: this.resolveClientSecret() };
		}

		const row = await getMcpOauthToken(this.session);
		return row?.clientInfo ?? undefined;
	}

	async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
		const clientInfo: McpOAuthClientInfo = {
			client_id: clientInformation.client_id,
			client_secret: clientInformation.client_secret,
			client_id_issued_at: clientInformation.client_id_issued_at,
			client_secret_expires_at: clientInformation.client_secret_expires_at,
		};
		await saveMcpOauthClientInfo(this.session, clientInfo);
	}

	async tokens(): Promise<OAuthTokens | undefined> {
		const row = await getMcpOauthToken(this.session);
		if (!row?.accessToken) {
			return undefined;
		}

		return {
			access_token: row.accessToken,
			token_type: 'Bearer',
			refresh_token: row.refreshToken ?? undefined,
			scope: row.scope ?? undefined,
			expires_in: row.accessTokenExpiresAt ? secondsUntil(row.accessTokenExpiresAt) : undefined,
		};
	}

	async saveTokens(tokens: OAuthTokens): Promise<void> {
		await saveMcpOauthTokens(this.session, {
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token ?? null,
			accessTokenExpiresAt: tokens.expires_in ? expiryFromNow(tokens.expires_in) : null,
			refreshTokenExpiresAt: null,
			scope: tokens.scope ?? null,
		});
	}

	redirectToAuthorization(authorizationUrl: URL): void {
		this._authorizationUrl = authorizationUrl;
	}

	saveCodeVerifier(codeVerifier: string): void {
		this._codeVerifier = codeVerifier;
	}

	codeVerifier(): string {
		if (!this._codeVerifier) {
			throw new Error(`Missing PKCE code verifier for MCP OAuth session '${this.session.serverName}'`);
		}
		return this._codeVerifier;
	}

	private resolveClientSecret(): string | undefined {
		if (!this.config.clientSecretEnv) {
			return undefined;
		}

		const secret = process.env[this.config.clientSecretEnv];
		if (!secret) {
			throw new Error(`MCP OAuth client secret env var '${this.config.clientSecretEnv}' is not set`);
		}
		return secret;
	}
}

function expiryFromNow(expiresInSeconds: number): Date {
	return new Date(Date.now() + expiresInSeconds * 1000);
}

function secondsUntil(date: Date): number {
	return Math.max(0, Math.floor((date.getTime() - Date.now()) / 1000));
}
