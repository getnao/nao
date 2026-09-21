/* @license Enterprise */

import type { FastifyRequest } from 'fastify';

import type { App } from '../app';
import { getAuth } from '../auth';
import { hasFeature, LICENSE_FEATURES } from '../services/license.service';
import { getOidcProviderId, isOidcConfigured } from '../services/oidc-auth.service';

const LOGIN_PATH = '/login';

export const ssoRoutes = async (app: App) => {
	app.get('/sso/start', async (request, reply) => {
		if (!(await hasFeature(LICENSE_FEATURES.sso)) || !isOidcConfigured()) {
			return reply.redirect(LOGIN_PATH, 302);
		}
		try {
			const { url, cookies } = await startOidcAuthorization(request);
			reply.header('set-cookie', cookies);
			return reply.redirect(url, 302);
		} catch (error) {
			app.log.error(error, 'Failed to start OIDC sign-in');
			return reply.redirect(LOGIN_PATH, 302);
		}
	});
};

async function startOidcAuthorization(request: FastifyRequest): Promise<{ url: string; cookies: string[] }> {
	const auth = await getAuth();
	const endpoint = new URL('/api/auth/sign-in/oauth2', `http://${request.headers.host}`);
	const response = await auth.handler(
		new Request(endpoint, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				providerId: getOidcProviderId(),
				callbackURL: '/',
				errorCallbackURL: LOGIN_PATH,
			}),
		}),
	);

	const { url } = (await response.json()) as { url?: string };
	if (!url) {
		throw new Error(`better-auth returned no authorization URL (status ${response.status})`);
	}
	return { url, cookies: response.headers.getSetCookie() };
}
