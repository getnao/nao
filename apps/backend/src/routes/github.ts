import crypto from 'node:crypto';

import type { App } from '../app';
import { getAuth } from '../auth';
import { env } from '../env';
import * as userQueries from '../queries/user.queries';
import * as githubService from '../services/github';
import { convertHeaders } from '../utils/utils';

function signState(payload: string): string {
	return crypto.createHmac('sha256', env.BETTER_AUTH_SECRET).update(payload).digest('base64url');
}

export const githubRoutes = async (app: App) => {
	app.get('/connect', async (request, reply) => {
		if (!githubService.isGithubIntegrationAvailable()) {
			return reply.status(400).send({ error: 'GitHub integration is not configured' });
		}

		const auth = await getAuth();
		const session = await auth.api.getSession({ headers: convertHeaders(request.headers) });
		if (!session?.user) {
			return reply.status(401).send({ error: 'Unauthorized' });
		}

		const payload = Buffer.from(JSON.stringify({ userId: session.user.id })).toString('base64url');
		const signature = signState(payload);
		const state = `${payload}.${signature}`;
		const url = githubService.buildAuthorizationUrl(state);
		return reply.redirect(url);
	});

	app.get('/callback', async (request, reply) => {
		const { code, state } = request.query as { code?: string; state?: string };
		if (!code || !state) {
			return reply.redirect('/settings/organization?github=error&reason=missing_params');
		}

		const auth = await getAuth();
		const session = await auth.api.getSession({ headers: convertHeaders(request.headers) });
		if (!session?.user) {
			return reply.redirect('/settings/organization?github=error&reason=unauthorized');
		}

		let userId: string;
		try {
			const [payload, signature] = state.split('.');
			if (!payload || !signature) {
				throw new Error('malformed state');
			}
			const expectedSignature = signState(payload);
			if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
				throw new Error('invalid signature');
			}
			const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
			userId = decoded.userId;
		} catch {
			return reply.redirect('/settings/organization?github=error&reason=invalid_state');
		}

		if (session.user.id !== userId) {
			return reply.redirect('/settings/organization?github=error&reason=user_mismatch');
		}

		try {
			const token = await githubService.exchangeCodeForToken(code);
			await userQueries.updateGithubToken(userId, token);
			return reply.redirect('/settings/organization?github=connected');
		} catch {
			return reply.redirect('/settings/organization?github=error&reason=exchange_failed');
		}
	});
};
