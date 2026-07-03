import crypto from 'node:crypto';

import type { App } from '../app';
import { getAuth } from '../auth';
import { env } from '../env';
import { setMcpDiscoveryUser } from '../queries/mcp-oauth.queries';
import * as projectQueries from '../queries/project.queries';
import { mcpService } from '../services/mcp';
import { buildAuthorizationRedirect, completeAuthorization } from '../services/mcp-oauth';
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

/** Page shown in the OAuth popup: notifies the chat window and closes itself. */
export function resultPage(status: 'connected' | 'error', server: string, returnTo: string): string {
	const payload = jsonForInlineScript({ type: 'nao-mcp-oauth', status, server });
	const target = jsonForInlineScript(`${returnTo}?mcp=${status}`);
	return `<!doctype html><html><head><meta charset="utf-8"><title>nao</title></head><body style="font-family:system-ui;padding:24px">
<p>${status === 'connected' ? 'Connected. You can close this window.' : 'Connection failed. You can close this window.'}</p>
<script>
	try { if (window.opener) { window.opener.postMessage(${payload}, window.location.origin); } } catch (e) {}
	if (window.opener) { window.close(); } else { window.location.href = ${target}; }
</script>
</body></html>`;
}

export const mcpOAuthRoutes = async (app: App) => {
	app.get('/connect', async (request, reply) => {
		const { server, projectId, returnTo } = request.query as {
			server?: string;
			projectId?: string;
			returnTo?: string;
		};
		if (!server) {
			return reply.status(400).send({ error: 'Missing server' });
		}

		const auth = await getAuth();
		const session = await auth.api.getSession({ headers: convertHeaders(request.headers) });
		if (!session?.user) {
			return reply.status(401).send({ error: 'Unauthorized' });
		}

		const project = await projectQueries.getProjectByUserId(session.user.id, projectId ?? null);
		if (!project) {
			return reply.status(400).send({ error: 'No project configured' });
		}

		const serverUrl = await mcpService.getServerUrl(project.id, server);
		if (!serverUrl) {
			return reply.status(400).send({ error: `MCP server "${server}" is not an HTTP server` });
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
			return reply.type('text/html').send(resultPage('error', server, normalizeReturnTo(returnTo)));
		}
	});

	app.get('/callback', async (request, reply) => {
		const { code, state } = request.query as { code?: string; state?: string };
		if (!code || !state) {
			return reply.status(400).send({ error: 'Missing code or state' });
		}

		const decoded = decodeState(state);
		if (!decoded) {
			return reply.status(400).send({ error: 'Invalid state' });
		}

		const auth = await getAuth();
		const session = await auth.api.getSession({ headers: convertHeaders(request.headers) });
		if (!session?.user || session.user.id !== decoded.userId) {
			return reply.type('text/html').send(resultPage('error', decoded.server, decoded.returnTo));
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
			});

			if (role === 'admin') {
				await setMcpDiscoveryUser(decoded.projectId, decoded.server, decoded.userId);
				await mcpService.discoverServer(decoded.projectId, decoded.server);
			}

			return reply.type('text/html').send(resultPage('connected', decoded.server, decoded.returnTo));
		} catch (error) {
			logger.error(`MCP OAuth callback failed: ${decoded.server}`, {
				source: 'tool',
				projectId: decoded.projectId,
				context: { server: decoded.server, error: String(error) },
			});
			return reply.type('text/html').send(resultPage('error', decoded.server, decoded.returnTo));
		}
	});
};
