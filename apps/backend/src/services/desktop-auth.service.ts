import type { BetterAuthPlugin } from 'better-auth';
import { createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod/v4';

import { consumeAuthorizationCode } from './cli-auth.service';

export const DESKTOP_SESSION_USER_AGENT = 'nao-desktop';
export const DESKTOP_AUTH_EXPIRED_REDIRECT = '/login?error=desktop_auth_expired';
const SIGNED_IN_REDIRECT = '/';

/**
 * Turns a one-time desktop code into a regular cookie session for the server's origin.
 * The endpoint is server-only so better-auth does not route it under /api/auth; Fastify exposes it at
 * /api/desktop-auth/session instead.
 */
export const desktopAuthPlugin = () =>
	({
		id: 'nao-desktop-auth',
		endpoints: {
			createDesktopSession: createAuthEndpoint(
				'/desktop-auth/session',
				{
					method: 'GET',
					query: z.object({ code: z.string().optional() }),
					metadata: { SERVER_ONLY: true },
				},
				async (ctx) => {
					const userId = ctx.query.code ? await consumeAuthorizationCode(ctx.query.code, 'desktop') : null;
					const user = userId ? await ctx.context.internalAdapter.findUserById(userId) : null;
					if (!user) {
						throw ctx.redirect(DESKTOP_AUTH_EXPIRED_REDIRECT);
					}

					const session = await ctx.context.internalAdapter.createSession(user.id, false, {
						userAgent: DESKTOP_SESSION_USER_AGENT,
					});
					await setSessionCookie(ctx, { session, user });
					throw ctx.redirect(SIGNED_IN_REDIRECT);
				},
			),
		},
	}) satisfies BetterAuthPlugin;
