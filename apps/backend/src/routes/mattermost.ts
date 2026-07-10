import type { App } from '../app';
import { getProjectMattermostConfig } from '../queries/project-mattermost-config.queries';
import { mattermostService } from '../services/mattermost';
import { convertHeaders } from '../utils/utils';

export const mattermostRoutes = async (app: App) => {
	app.post('/:projectId', async (request, reply) => {
		const { projectId } = request.params as { projectId: string };
		const webRequest = new Request(`http://localhost${request.url}`, {
			method: request.method,
			headers: convertHeaders(request.headers),
			body: JSON.stringify(request.body),
		});

		const mattermostConfig = await getProjectMattermostConfig(projectId);
		if (!mattermostConfig) {
			reply.status(200).send('OK');
			return;
		}

		const webhooks = await mattermostService.getWebhooks(mattermostConfig);
		if (!webhooks) {
			reply.status(200).send('OK');
			return;
		}

		const response = await webhooks.mattermost(webRequest, {
			waitUntil: (task: Promise<unknown>) => task,
		});

		reply.status(response.status);
		response.headers.forEach((value, key) => reply.header(key, value));
		return reply.send(await response.text());
	});
};
