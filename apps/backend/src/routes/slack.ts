import type { App } from '../app';
import { slackAuthMiddleware } from '../middleware/auth';
import { SlackService } from '../services/slack.service';
import { SlackRequest } from '../types/slack';

export const slackRoutes = async (app: App) => {
	// Verifying requests from Slack : verify whether requests from Slack are authentic
	// https://docs.slack.dev/authentication/verifying-requests-from-slack/#signing_secrets_admin_page
	app.addHook('preHandler', slackAuthMiddleware);

	app.post('/app_mention', { config: { rawBody: true } }, async (request, reply) => {
		try {
			const body = request.body as SlackRequest;

			if (body.type === 'url_verification') {
				return reply.send({ challenge: body.challenge });
			}

			const slackService = new SlackService(body);
			await slackService.sendRequestAcknowledgement(reply);

			await slackService.handleWorkFlow(reply);
		} catch (error) {
			return reply.status(500).send({ error });
		}
	});
};
