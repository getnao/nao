import { z } from 'zod/v4';

import type { App } from '../app';
import { authMiddleware } from '../middleware/auth';
import { createCliAuthorizationCode, exchangeCliAuthorizationCode } from '../services/cli-auth.service';

/**
 * Browser-based login flow for the nao CLI. The CLI opens /cli-login in the
 * browser, the logged-in user approves, and the frontend calls /authorize to
 * mint a one-time code that it forwards to the CLI's localhost callback. The
 * CLI then exchanges the code for a session token via /token.
 */
export const cliAuthRoutes = async (app: App) => {
	app.post('/authorize', { preHandler: authMiddleware }, async (request) => {
		const code = await createCliAuthorizationCode(request.user.id);
		return { code };
	});

	app.post(
		'/token',
		{
			schema: {
				body: z.object({ code: z.string().min(1) }),
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
