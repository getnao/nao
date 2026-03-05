import type { App } from '../app';
import * as slackConfigQueries from '../queries/project-slack-config.queries';
import { slackService } from '../services/slack';
import { convertHeaders } from '../utils/utils';

export const slackRoutes = async (app: App) => {
	app.post('/:projectId', { config: { rawBody: true } }, async (request, reply) => {
		const webRequest = new Request(`http://localhost${request.url}`, {
			method: request.method,
			headers: convertHeaders(request.headers),
			body: request.rawBody as string,
		});

		const slackConfig = await slackConfigQueries.getSlackConfig();
		if (!slackConfig) {
			throw new Error('Slack configuration not found');
		}

		const webhooks = slackService.getWebhooks(slackConfig);
		if (!webhooks) {
			throw new Error('Failed to initialize Slack webhooks');
		}
		const response = await webhooks.slack(webRequest, {
			waitUntil: (task: Promise<unknown>) => task,
		});

		reply.status(response.status);
		response.headers.forEach((value, key) => reply.header(key, value));
		return reply.send(await response.text());
	});
};
