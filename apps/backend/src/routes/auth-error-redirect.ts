import type { App } from '../app';

export const authErrorRedirectRoutes = async (app: App) => {
	app.get('/auth/error', (request, reply) => {
		const url = new URL(request.url, `http://${request.headers.host}`);
		const qs = url.searchParams.toString();
		const target = qs ? `/login?${qs}` : '/login';
		return reply.redirect(target, 302);
	});
};
