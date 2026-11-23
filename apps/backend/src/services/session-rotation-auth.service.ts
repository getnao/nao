import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, sessionMiddleware } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';

/**
 * Replaces the current session with a fresh token while keeping its timestamps, so the
 * browser stays signed in and the previous token (e.g. pasted in an MCP client) stops working.
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
					const { id: _id, token: previousToken, ...preservedFields } = session;
					const rotated = await ctx.context.internalAdapter.createSession(
						user.id,
						false,
						preservedFields,
						true,
					);
					if (!rotated) {
						throw new APIError('INTERNAL_SERVER_ERROR', { message: 'Failed to rotate the session.' });
					}
					await ctx.context.internalAdapter.deleteSession(previousToken);
					await setSessionCookie(ctx, { session: rotated, user });
					return ctx.json({ token: rotated.token });
				},
			),
		},
	} satisfies BetterAuthPlugin;
}
