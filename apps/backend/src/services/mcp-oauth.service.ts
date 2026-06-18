import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { mcpJsonSchema, McpOAuthConfig } from '@nao/shared';

import { env } from '../env';
import {
	createMcpOauthFlow,
	deleteExpiredMcpOauthFlows,
	deleteMcpOauthFlow,
	getMcpOauthFlow,
} from '../queries/mcp-oauth-flow.queries';
import { retrieveProjectById } from '../queries/project.queries';
import { replaceEnvVars } from '../utils/utils';
import { McpOAuthProvider } from './mcp-oauth-provider';

const FLOW_TTL_MS = 10 * 60 * 1000;
const DEFAULT_RETURN_TO = '/settings/project/mcp-servers';

export const MCP_OAUTH_ROUTE_PREFIX = '/api/mcp-oauth';

/** Raised for user- or config-level failures the routes should surface as a 4xx, not a 500. */
export class McpOAuthError extends Error {}

export type StartFlowResult = { status: 'connected' } | { status: 'redirect'; authorizationUrl: string };

export interface StartFlowParams {
	userId: string;
	projectId: string;
	serverName: string;
	returnTo?: string;
}

export interface CompleteFlowParams {
	state: string;
	code: string;
	userId: string;
}

export interface CompleteFlowResult {
	returnTo: string;
	serverName: string;
}

/**
 * Begins an OAuth authorization for a user against a remote MCP server. Runs the SDK auth
 * orchestrator (discovery + dynamic client registration as needed) and either reports the
 * user is already connected or persists the pending PKCE flow and returns the authorize URL.
 */
export async function startMcpOAuthFlow(params: StartFlowParams): Promise<StartFlowResult> {
	const { userId, projectId, serverName, returnTo } = params;
	const { url, oauth } = await loadMcpOAuthServer(projectId, serverName);

	const provider = new McpOAuthProvider({
		session: { userId, projectId, serverName },
		config: oauth,
		redirectUri: mcpOAuthRedirectUri(),
	});

	const result = await auth(provider, { serverUrl: url, scope: scopeOf(oauth) });
	if (result === 'AUTHORIZED') {
		return { status: 'connected' };
	}

	const authorizationUrl = provider.authorizationUrl;
	if (!authorizationUrl) {
		throw new McpOAuthError('OAuth provider did not produce an authorization URL');
	}

	await deleteExpiredMcpOauthFlows(new Date());
	await createMcpOauthFlow({
		state: provider.state(),
		userId,
		projectId,
		serverName,
		codeVerifier: provider.codeVerifier(),
		returnTo: normalizeReturnTo(returnTo),
		expiresAt: new Date(Date.now() + FLOW_TTL_MS),
	});

	return { status: 'redirect', authorizationUrl: authorizationUrl.toString() };
}

/**
 * Completes an OAuth authorization from the callback leg: validates the pending flow, exchanges
 * the authorization code for tokens (persisted by the provider), and clears the flow.
 */
export async function completeMcpOAuthFlow(params: CompleteFlowParams): Promise<CompleteFlowResult> {
	const { state, code, userId } = params;

	const flow = await getMcpOauthFlow(state);
	if (!flow) {
		throw new McpOAuthError('Authorization session not found or already used');
	}
	if (flow.expiresAt.getTime() < Date.now()) {
		await deleteMcpOauthFlow(state);
		throw new McpOAuthError('Authorization session expired');
	}
	if (flow.userId !== userId) {
		throw new McpOAuthError('Authorization session does not belong to the current user');
	}

	const { url, oauth } = await loadMcpOAuthServer(flow.projectId, flow.serverName);
	const provider = new McpOAuthProvider({
		session: { userId: flow.userId, projectId: flow.projectId, serverName: flow.serverName },
		config: oauth,
		redirectUri: mcpOAuthRedirectUri(),
		state,
		codeVerifier: flow.codeVerifier,
	});

	const result = await auth(provider, { serverUrl: url, authorizationCode: code });
	await deleteMcpOauthFlow(state);
	if (result !== 'AUTHORIZED') {
		throw new McpOAuthError('Token exchange did not complete');
	}

	return { returnTo: flow.returnTo ?? DEFAULT_RETURN_TO, serverName: flow.serverName };
}

export function mcpOAuthRedirectUri(): string {
	const baseUrl = env.BETTER_AUTH_URL.replace(/\/+$/, '');
	return `${baseUrl}${MCP_OAUTH_ROUTE_PREFIX}/callback`;
}

async function loadMcpOAuthServer(projectId: string, serverName: string): Promise<{ url: URL; oauth: McpOAuthConfig }> {
	const project = await retrieveProjectById(projectId);
	const filePath = join(project.path || '', 'agent', 'mcps', 'mcp.json');
	if (!existsSync(filePath)) {
		throw new McpOAuthError('No MCP configuration found for this project');
	}

	const parsed = mcpJsonSchema.parse(JSON.parse(replaceEnvVars(readFileSync(filePath, 'utf8'))));
	const config = parsed.mcpServers[serverName];
	if (!config) {
		throw new McpOAuthError(`MCP server '${serverName}' is not configured`);
	}
	if (!config.oauth || !config.url) {
		throw new McpOAuthError(`MCP server '${serverName}' does not use OAuth`);
	}

	return { url: config.url, oauth: config.oauth };
}

function scopeOf(oauth: McpOAuthConfig): string | undefined {
	return oauth.scopes?.length ? oauth.scopes.join(' ') : undefined;
}

function normalizeReturnTo(value: string | undefined): string | null {
	if (!value || !value.startsWith('/') || value.startsWith('//')) {
		return null;
	}
	return value;
}
