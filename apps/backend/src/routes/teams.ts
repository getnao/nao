import type { App } from '../app';
import { getTeamsConfig } from '../queries/project-teams-config.queries';
import { teamsService } from '../services/teams';
import { convertHeaders } from '../utils/utils';

export const teamsRoutes = async (app: App) => {
	app.post('/:projectId', async (request, reply) => {
		const webRequest = new Request(`http://localhost${request.url}`, {
			method: request.method,
			headers: convertHeaders(request.headers),
			body: JSON.stringify(request.body),
		});

		const teamsConfig = await getTeamsConfig();
		if (!teamsConfig) {
			throw new Error('Teams configuration not found');
		}

		const webhooks = teamsService.getWebhooks(teamsConfig);
		if (!webhooks) {
			throw new Error('Failed to initialize Teams webhooks');
		}

		const response = await webhooks.teams(webRequest, {
			waitUntil: (task: Promise<unknown>) => task,
		});

		reply.status(response.status);
		response.headers.forEach((value, key) => reply.header(key, value));
		return reply.send(await response.text());
	});
};
