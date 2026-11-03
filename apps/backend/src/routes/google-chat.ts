import type { App } from '../app';
import { getProjectGoogleChatConfig } from '../queries/project-google-chat-config.queries';
import { googleChatService } from '../services/google-chat';
import { convertHeaders } from '../utils/utils';

export const googleChatRoutes = async (app: App) => {
	app.post('/:projectId', async (request, reply) => {
		const { projectId } = request.params as { projectId: string };
		const googleChatConfig = await getProjectGoogleChatConfig(projectId);
		if (!googleChatConfig) {
			return reply.status(404).send({ error: 'Google Chat configuration not found' });
		}

		const webRequest = new Request(`http://localhost${request.url}`, {
			method: request.method,
			headers: convertHeaders(request.headers),
			body: JSON.stringify(request.body),
		});
		const webhooks = googleChatService.getWebhooks(googleChatConfig);
		const response = await webhooks.gchat(webRequest, {
			waitUntil: (task: Promise<unknown>) => {
				return task;
			},
		});

		reply.status(response.status);
		response.headers.forEach((value, key) => reply.header(key, value));
		return reply.send(await response.text());
	});
};
