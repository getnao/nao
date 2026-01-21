import type { App } from '../app';
import { slackAuthMiddleware } from '../middleware/slack.middleware';
import { SlackService } from '../services/slack.service';
import { SlackInteractionPayload, SlackRequestSchema } from '../types/slack';
import { activeSlackStreams } from '../utils/slack';

export const slackRoutes = async (app: App) => {
	// Verifying requests from Slack : verify whether requests from Slack are authentic
	// https://docs.slack.dev/authentication/verifying-requests-from-slack/#signing_secrets_admin_page
	app.addHook('preHandler', slackAuthMiddleware);

	app.post(
		'/app_mention',
		{
			config: { rawBody: true },
			schema: { body: SlackRequestSchema },
		},
		async (request, reply) => {
			const body = request.body;

			if (body.type === 'url_verification') {
				return reply.send({ challenge: body.challenge });
			}

			if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_SIGNING_SECRET) {
				return reply
					.status(400)
					.send({ error: 'SLACK_BOT_TOKEN or SLACK_SIGNING_SECRET is not defined in environment variables' });
			}

			if (!body.event) {
				return reply.status(400).send({ error: 'Invalid request: missing event object' });
			}

			if (!body.event.text || !body.event.channel || !body.event.ts || !body.event.user) {
				return reply
					.status(400)
					.send({ error: 'Invalid request: missing text, channel, thread timestamp, or user ID' });
			}

			const slackService = new SlackService(body.event);
			await slackService.handleWorkFlow(reply);
		},
	);

	app.post(
		'/interactions',
		{
			config: { rawBody: true },
		},
		async (request, reply) => {
			const body = request.body as { payload: string };

			if (!body.payload) {
				return reply.status(400).send({ error: 'Missing payload' });
			}

			const payload = JSON.parse(body.payload) as SlackInteractionPayload;

			if (payload.type === 'block_actions' && payload.actions) {
				for (const action of payload.actions) {
					if (action.action_id === 'stop_generation') {
						const channel = payload.channel?.id;
						const threadTs = payload.message?.thread_ts || payload.message?.ts;

						if (channel && threadTs) {
							const threadId = [channel, threadTs.replace('.', '')].join('/p');
							const abortController = activeSlackStreams.get(threadId);

							if (abortController) {
								abortController.abort();
								activeSlackStreams.delete(threadId);
							}
						}
					}
				}
			}
		},
	);
};
