import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod/v4';

import type { App } from '../app';
import { getAuth } from '../auth';
import { authMiddleware } from '../middleware/auth';
import {
	AUTHORIZATION_CLIENTS,
	createAuthorizationCode,
	exchangeCliAuthorizationCode,
	isTrustedOrigin,
} from '../services/cli-auth.service';
import { convertHeaders } from '../utils/utils';

/**
 * Browser-based login flow for the nao CLI and desktop app. The client opens /cli-login in the
 * browser, the logged-in user approves, and the frontend calls /authorize to mint a one-time code
 * that it forwards to the client's localhost callback. The CLI then exchanges the code for a
 * session token via /token; the desktop app redeems it through /api/desktop-auth/session.
 */
export const cliAuthRoutes = async (app: App) => {
	app.post(
		'/authorize',
		{
			preHandler: [requireBrowserRequest, authMiddleware],
			schema: {
				body: z.object({ client: z.enum(AUTHORIZATION_CLIENTS).optional() }).nullish(),
			},
		},
		async (request) => {
			const code = await createAuthorizationCode(request.user.id, request.body?.client ?? 'cli');
			return { code };
		},
	);

	app.post(
		'/token',
		{
			schema: {
				body: z.object({ code: z.string().min(1).max(43) }),
			},
		},
		async (request, reply) => {
			const token = await exchangeCliAuthorizationCode(request.body.code);
			if (!token) {
				return reply.status(400).send({ error: 'Invalid or expired authorization code' });
			}
			return { token };
		},
	);
};

/**
 * The desktop webview lands here after the browser sign-in. better-auth sets its own session cookie,
 * then the webview is redirected to the app (or back to /login when the code is not valid).
 */
export const desktopAuthRoutes = async (app: App) => {
	app.get(
		'/session',
		{
			schema: {
				querystring: z.object({ code: z.string().optional() }),
			},
		},
		async (request, reply) => {
			const auth = await getAuth();
			const response = await auth.api.createDesktopSession({
				query: { code: request.query.code },
				headers: convertHeaders(request.headers),
				asResponse: true,
			});
			reply.status(response.status).header('Referrer-Policy', 'no-referrer');
			response.headers.forEach((value, key) => reply.header(key, value));
			return reply.send();
		},
	);
};

/**
 * Only a cookie session from the web app may mint CLI codes: bearer tokens are
 * rejected so a session cannot renew itself indefinitely, and the origin check
 * guards against cross-site requests.
 */
async function requireBrowserRequest(request: FastifyRequest, reply: FastifyReply) {
	if (request.headers.authorization) {
		return reply.status(403).send({ error: 'CLI authorization requires a browser session' });
	}
	if (!(await isTrustedOrigin(request.headers.origin))) {
		return reply.status(403).send({ error: 'Untrusted origin' });
	}
}
