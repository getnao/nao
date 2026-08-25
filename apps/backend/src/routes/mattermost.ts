import type { App } from '../app';
import { mattermostService } from '../services/mattermost';
import { logger } from '../utils/logger';
import { verifyMattermostActionSecret } from '../utils/mattermost-action-secret';
import { convertHeaders } from '../utils/utils';

export const mattermostRoutes = async (app: App) => {
	app.post('/:projectId/:token', async (request, reply) => {
		const { projectId, token } = request.params as { projectId: string; token: string };
		if (!verifyMattermostActionSecret(projectId, token)) {
			logger.warn('Rejected Mattermost callback', {
				source: 'http',
				projectId,
				context: { reason: 'invalid-token' },
			});
			return reply.status(200).send('OK');
		}

		const adapter = mattermostService.getAdapter(projectId);
		if (!adapter) {
			logger.warn('Rejected Mattermost callback', {
				source: 'http',
				projectId,
				context: { reason: 'adapter-not-running' },
			});
			return reply.status(200).send('OK');
		}

		const webRequest = new Request(`http://localhost${request.url}`, {
			method: request.method,
			headers: convertHeaders(request.headers),
			body: JSON.stringify(request.body),
		});
		const response = await adapter.handleWebhook(webRequest, {
			waitUntil: (task: Promise<unknown>) => task,
		});

		reply.status(response.status);
		response.headers.forEach((value, key) => reply.header(key, value));
		return reply.send(await response.text());
	});
};
