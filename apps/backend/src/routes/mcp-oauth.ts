import crypto from 'node:crypto';

import { isMcpServerGranted, type UserRole } from '@nao/shared';
import type { FastifyReply } from 'fastify';

import type { App } from '../app';
import { getSession } from '../auth';
import { env } from '../env';
import { claimMcpDiscoveryUser, setMcpDiscoveryUser } from '../queries/mcp-oauth.queries';
import * as projectQueries from '../queries/project.queries';
import { mcpService } from '../services/mcp';
import { buildAuthorizationRedirect, completeAuthorization } from '../services/mcp-oauth';
import { resolveMcpSettingsAccess } from '../services/user-group-context-access.service';
import { logger } from '../utils/logger';
import { convertHeaders } from '../utils/utils';

interface StatePayload {
	userId: string;
	projectId: string;
	server: string;
	returnTo: string;
}

function signState(payload: string): string {
	return crypto.createHmac('sha256', env.BETTER_AUTH_SECRET).update(payload).digest('base64url');
}

function encodeState(payload: StatePayload): string {
	const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
	return `${encoded}.${signState(encoded)}`;
}

function decodeState(state: string): StatePayload | null {
	try {
		const [encoded, signature] = state.split('.');
		if (!encoded || !signature) {
			return null;
		}
		const expected = signState(encoded);
		const signatureBuffer = Buffer.from(signature);
		const expectedBuffer = Buffer.from(expected);
		if (
			signatureBuffer.length !== expectedBuffer.length ||
			!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
		) {
			return null;
		}
		return JSON.parse(Buffer.from(encoded, 'base64url').toString()) as StatePayload;
	} catch {
		return null;
	}
}

export function normalizeReturnTo(value: unknown): string {
	if (typeof value !== 'string') {
		return '/';
	}
	const path = value.split(/[?#]/, 1)[0];
	return /^\/[A-Za-z0-9/_-]*$/.test(path) && !path.startsWith('//') ? path : '/';
}

function jsonForInlineScript(value: unknown): string {
	return JSON.stringify(value)
		.replace(/</g, '\\u003c')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Page shown in the OAuth popup. On success it notifies the chat window and closes itself; on
 * failure it stays open with the provider's error so the user can see what went wrong.
 */
export function resultPage(status: 'connected' | 'error', server: string, returnTo: string, message?: string): string {
	const payload = jsonForInlineScript({ type: 'nao-mcp-oauth', status, server, message });
	const target = jsonForInlineScript(`${returnTo}?mcp=${status}`);
	const body =
		status === 'connected'
			? '<p>Connected. You can close this window.</p>'
			: `<p>Could not connect to <strong>${escapeHtml(server)}</strong>.</p>
<pre style="white-space:pre-wrap;word-break:break-word;background:#f4f4f5;padding:12px;border-radius:6px">${escapeHtml(message ?? 'Connection failed.')}</pre>
<button id="close" style="padding:6px 12px">Close</button>`;
	const onLoad =
		status === 'connected'
			? `if (window.opener) { window.close(); } else { window.location.href = ${target}; }`
			: `document.getElementById('close').addEventListener('click', function () { if (window.opener) { window.close(); } else { window.location.href = ${target}; } });`;
	return `<!doctype html><html><head><meta charset="utf-8"><title>nao</title></head><body style="font-family:system-ui;padding:24px">
${body}
<script>
	try { if (window.opener) { window.opener.postMessage(${payload}, window.location.origin); } } catch (e) {}
	${onLoad}
</script>
</body></html>`;
}

function sendConnectError(reply: FastifyReply, server: string, returnTo: unknown, message: string): FastifyReply {
	return reply.type('text/html').send(resultPage('error', server, normalizeReturnTo(returnTo), message));
}

/**
 * Tool discovery runs with a single user's token. An admin always takes it over on connect;
 * a regular user only claims it when no admin ever connected the server, so the agent still
 * gets its tool specs instead of seeing an empty server.
 */
async function claimDiscovery(role: UserRole, projectId: string, server: string, userId: string): Promise<boolean> {
	if (role === 'admin') {
		await setMcpDiscoveryUser(projectId, server, userId);
		return true;
	}
	return claimMcpDiscoveryUser(projectId, server, userId);
}

export const mcpOAuthRoutes = async (app: App) => {
	app.get('/connect', async (request, reply) => {
		const { server, projectId, returnTo } = request.query as {
			server?: unknown;
			projectId?: string;
			returnTo?: string;
		};
		if (typeof server !== 'string' || !server) {
			return reply.status(400).send({ error: 'Missing server' });
		}

		const session = await getSession(convertHeaders(request.headers));
		if (!session?.user) {
			return sendConnectError(reply.status(401), server, returnTo, 'Sign in to nao, then try again.');
		}

		const project = await projectQueries.getProjectByUserId(session.user.id, projectId ?? null);
		if (!project) {
			return sendConnectError(reply.status(400), server, returnTo, 'No project configured.');
		}

		const role = await projectQueries.getUserRoleInProject(project.id, session.user.id);
		if (!isMcpServerGranted(await resolveMcpSettingsAccess(project.id, session.user.id, role), server)) {
			return sendConnectError(
				reply.status(403),
				server,
				returnTo,
				`MCP server "${server}" is not available for your user group.`,
			);
		}

		const serverUrl = await mcpService.getServerUrl(project.id, server);
		if (!serverUrl) {
			return sendConnectError(
				reply.status(400),
				server,
				returnTo,
				`MCP server "${server}" is not an HTTP server.`,
			);
		}

		const state = encodeState({
			userId: session.user.id,
			projectId: project.id,
			server,
			returnTo: normalizeReturnTo(returnTo),
		});

		try {
			const result = await buildAuthorizationRedirect({
				projectId: project.id,
				userId: session.user.id,
				server,
				serverUrl,
				signedState: state,
				staticClient: await mcpService.getServerOAuthClient(project.id, server),
			});
			if (result.status === 'redirect') {
				return reply.redirect(result.url);
			}
			return reply.type('text/html').send(resultPage('connected', server, normalizeReturnTo(returnTo)));
		} catch (error) {
			logger.error(`MCP OAuth connect failed: ${server}`, {
				source: 'tool',
				projectId: project.id,
				context: { server, error: String(error) },
			});
			return sendConnectError(reply, server, returnTo, errorMessage(error));
		}
	});

	app.get('/callback', async (request, reply) => {
		const { code, state, error, error_description } = request.query as {
			code?: string;
			state?: string;
			error?: string;
			error_description?: string;
		};
		if (!state) {
			return reply.status(400).send({ error: 'Missing state' });
		}

		const decoded = decodeState(state);
		if (!decoded) {
			return reply.status(400).send({ error: 'Invalid state' });
		}

		if (error || !code) {
			const providerError = [error ?? 'Missing authorization code', error_description].filter(Boolean).join(': ');
			return reply.type('text/html').send(resultPage('error', decoded.server, decoded.returnTo, providerError));
		}

		const session = await getSession(convertHeaders(request.headers));
		if (!session?.user || session.user.id !== decoded.userId) {
			return reply
				.type('text/html')
				.send(
					resultPage(
						'error',
						decoded.server,
						decoded.returnTo,
						'Sign in to nao in this browser with the account that started the connection, then try again.',
					),
				);
		}

		try {
			const role = await projectQueries.getUserRoleInProject(decoded.projectId, decoded.userId);
			if (!role) {
				throw new Error('User no longer has access to the project');
			}

			const serverUrl = await mcpService.getServerUrl(decoded.projectId, decoded.server);
			if (!serverUrl) {
				throw new Error('Server is no longer configured as HTTP');
			}

			await completeAuthorization({
				projectId: decoded.projectId,
				userId: decoded.userId,
				server: decoded.server,
				serverUrl,
				signedState: state,
				code,
				staticClient: await mcpService.getServerOAuthClient(decoded.projectId, decoded.server),
			});

			if (await claimDiscovery(role, decoded.projectId, decoded.server, decoded.userId)) {
				await mcpService.discoverServer(decoded.projectId, decoded.server);
			}

			return reply.type('text/html').send(resultPage('connected', decoded.server, decoded.returnTo));
		} catch (error) {
			logger.error(`MCP OAuth callback failed: ${decoded.server}`, {
				source: 'tool',
				projectId: decoded.projectId,
				context: { server: decoded.server, error: String(error) },
			});
			return reply
				.type('text/html')
				.send(resultPage('error', decoded.server, decoded.returnTo, errorMessage(error)));
		}
	});
};
