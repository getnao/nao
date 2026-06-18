import type { FastifyRequest } from 'fastify';

import type { App } from '../app';
import { getAuth } from '../auth';
import { getUserRoleInProject } from '../queries/project.queries';
import { completeMcpOAuthFlow, McpOAuthError, startMcpOAuthFlow } from '../services/mcp-oauth.service';
import { logger } from '../utils/logger';
import { convertHeaders } from '../utils/utils';

const SETTINGS_PATH = '/settings/project/mcp-servers';

export const mcpOauthRoutes = async (app: App) => {
	app.get('/connect/:projectId/:serverName', async (request, reply) => {
		const user = await getSessionUser(request);
		if (!user) {
			return reply.status(401).send({ error: 'Unauthorized' });
		}

		const { projectId, serverName } = request.params as { projectId: string; serverName: string };
		const role = await getUserRoleInProject(projectId, user.id);
		if (!role) {
			return reply.status(403).send({ error: 'You do not have access to this project' });
		}

		const { returnTo } = request.query as { returnTo?: string };
		try {
			const result = await startMcpOAuthFlow({ userId: user.id, projectId, serverName, returnTo });
			return reply.send(result);
		} catch (error) {
			if (error instanceof McpOAuthError) {
				return reply.status(400).send({ error: error.message });
			}
			logger.error(`MCP OAuth connect failed: ${serverName}`, {
				source: 'tool',
				projectId,
				context: { serverName, error: String(error) },
			});
			return reply.status(500).send({ error: 'Failed to start the OAuth flow' });
		}
	});

	app.get('/callback', async (request, reply) => {
		const {
			code,
			state,
			error: providerError,
		} = request.query as { code?: string; state?: string; error?: string };
		if (providerError) {
			return reply.redirect(failureRedirect('provider_denied'));
		}
		if (!code || !state) {
			return reply.redirect(failureRedirect('missing_params'));
		}

		const user = await getSessionUser(request);
		if (!user) {
			return reply.redirect(failureRedirect('unauthorized'));
		}

		try {
			const { returnTo, serverName } = await completeMcpOAuthFlow({ state, code, userId: user.id });
			return reply.redirect(`${returnTo}?mcp=connected&server=${encodeURIComponent(serverName)}`);
		} catch (error) {
			logger.error(`MCP OAuth callback failed: ${String(error)}`, {
				source: 'tool',
				context: { error: String(error) },
			});
			return reply.redirect(failureRedirect('exchange_failed'));
		}
	});
};

async function getSessionUser(request: FastifyRequest): Promise<{ id: string } | null> {
	const auth = await getAuth();
	const session = await auth.api.getSession({ headers: convertHeaders(request.headers) });
	return session?.user ?? null;
}

function failureRedirect(reason: string): string {
	return `${SETTINGS_PATH}?mcp=error&reason=${reason}`;
}
