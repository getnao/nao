import type { App } from '../app';
import { slackAuthMiddleware } from '../middleware/auth';
import { SlackService } from '../services/slackService';
import { SlackRequest } from '../types/slack';

export const slackRoutes = async (app: App) => {
	app.addHook('preHandler', slackAuthMiddleware);

	app.post('/app_mention', { config: { rawBody: true } }, async (request, reply) => {
		try {
			const body = request.body as SlackRequest;

			if (body.type === 'url_verification') {
				return reply.send({ challenge: body.challenge });
			}

			const text = (body.event?.text ?? '').replace(/<@[A-Z0-9]+>/gi, '').trim();
			const channel = body.event?.channel;
			const threadTs = body.event?.thread_ts || body.event?.ts;

			if (!text || !channel || !threadTs) {
				throw new Error('Invalid request: missing text, channel, or thread timestamp');
			}

			const slackService = new SlackService(body, channel, threadTs);

			const user = await slackService.getUser(reply);

			await slackService.sendRequestAcknowledgement(reply);

			await slackService.handleWorkFlow(user, text);
		} catch (error) {
			return reply.status(500).send({ error });
		}
	});
};
