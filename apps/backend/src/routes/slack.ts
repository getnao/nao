import type { App } from '../app';
import * as slackConfigQueries from '../queries/project-slack-config.queries';
import { slackService } from '../services/slack';

export const slackRoutes = async (app: App) => {
	app.post('/:projectId', { config: { rawBody: true } }, async (request) => {
		const webRequest = new Request(`http://localhost${request.url}`, {
			method: request.method,
			headers: request.headers as Record<string, string>,
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
		return webhooks.slack(webRequest, {
			waitUntil: (task: Promise<unknown>) => task,
		});
	});
};
