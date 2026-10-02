import type { App } from '../app';
import { discordService } from '../services/discord';
import { logger } from '../utils/logger';
import { convertHeaders } from '../utils/utils';

export const discordRoutes = async (app: App) => {
	// Discord signs every interaction with its Ed25519 key, so the adapter must
	// verify the exact bytes Discord sent — keep the raw body, do not re-encode.
	app.post('/:projectId', { config: { rawBody: true } }, async (request, reply) => {
		const { projectId } = request.params as { projectId: string };

		const adapter = discordService.getAdapter(projectId);
		if (!adapter) {
			logger.warn('Rejected Discord interaction', {
				source: 'http',
				projectId,
				context: { reason: 'adapter-not-running' },
			});
			return reply.status(200).send({});
		}

		const webRequest = new Request(`http://localhost${request.url}`, {
			method: request.method,
			headers: convertHeaders(request.headers),
			body: request.rawBody as string,
		});
		const response = await adapter.handleWebhook(webRequest, {
			waitUntil: (task: Promise<unknown>) => task,
		});

		reply.status(response.status);
		response.headers.forEach((value, key) => reply.header(key, value));
		return reply.send(await response.text());
	});
};
