import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, sessionMiddleware } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { generateRandomString } from 'better-auth/crypto';

const SESSION_TOKEN_LENGTH = 32;

/**
 * Swaps the current session token in place, so the browser stays signed in, the session keeps
 * its lifetime, and the previous token (e.g. pasted in an MCP client) stops working. The swap is a
 * single conditional update: concurrent rotations of the same token cannot both succeed.
 */
export function sessionRotation() {
	return {
		id: 'session-rotation',
		endpoints: {
			rotateSession: createAuthEndpoint(
				'/rotate-session',
				{ method: 'POST', use: [sessionMiddleware] },
				async (ctx) => {
					const { session, user } = ctx.context.session;
					const token = generateRandomString(SESSION_TOKEN_LENGTH, 'a-z', 'A-Z', '0-9');
					const rotated = await ctx.context.internalAdapter.updateSession(session.token, { token });
					if (!rotated) {
						throw new APIError('CONFLICT', { message: 'The session was already rotated.' });
					}
					await setSessionCookie(ctx, { session: rotated, user });
					return ctx.json({ token: rotated.token });
				},
			),
		},
	} satisfies BetterAuthPlugin;
}
