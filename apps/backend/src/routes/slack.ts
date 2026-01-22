import type { App } from '../app';
import { slackAuthMiddleware } from '../middleware/slack.middleware';
import * as chatQueries from '../queries/chat.queries';
import * as slackConfigQueries from '../queries/project-slack-config.queries';
import { agentService } from '../services/agent.service';
import { SlackService } from '../services/slack.service';
import { SlackInteractionBodySchema, SlackInteractionPayloadSchema, SlackRequestSchema } from '../types/slack';

export const slackRoutes = async (app: App) => {
	// Verifying requests from Slack : verify whether requests from Slack are authentic
	// https://docs.slack.dev/authentication/verifying-requests-from-slack/#signing_secrets_admin_page
	app.addHook('preHandler', slackAuthMiddleware);

	app.post(
		'/:projectId/app_mention',
		{
			config: { rawBody: true },
			schema: { body: SlackRequestSchema },
		},
		async (request, reply) => {
			const body = request.body;

			if (body.type === 'url_verification') {
				return reply.send({ challenge: body.challenge });
			}

			const slackConfig = await slackConfigQueries.getSlackConfig();

			if (!slackConfig) {
				return reply.status(400).send({ error: 'Slack is not configured' });
			}

			if (!body.event) {
				return reply.status(400).send({ error: 'Invalid request: missing event object' });
			}

			if (!body.event.text || !body.event.channel || !body.event.ts || !body.event.user) {
				return reply
					.status(400)
					.send({ error: 'Invalid request: missing text, channel, thread timestamp, or user ID' });
			}

			const slackService = new SlackService(body.event, slackConfig);
			reply.send({ ok: true });
			await slackService.handleWorkFlow(reply);
		},
	);

	app.post(
		'/:projectId/interactions',
		{
			config: { rawBody: true },
			schema: { body: SlackInteractionBodySchema },
		},
		async (request, reply) => {
			const body = request.body;

			if (!body.payload) {
				return reply.status(400).send({ error: 'Missing payload' });
			}

			const payload = SlackInteractionPayloadSchema.safeParse(JSON.parse(body.payload));
			if (!payload.success) {
				return reply.status(400).send({ error: 'Invalid payload structure' });
			}

			const { data } = payload;

			if (data.type !== 'block_actions' || !data.actions) {
				return reply.status(400).send({ error: 'Unsupported interaction type' });
			}

			for (const action of data.actions) {
				const channel = data.channel?.id;
				const threadTs = data.message?.thread_ts || data.message?.ts;

				if (action.action_id !== 'stop_generation' || !channel || !threadTs) {
					continue;
				}

				const threadId = [channel, threadTs.replace('.', '')].join('/p');
				const existingChat = await chatQueries.getChatBySlackThread(threadId);
				if (!existingChat) {
					return reply.status(500).send({ error: `Chat with thread ID ${threadId} not found.` });
				}
				agentService.get(existingChat.id)?.stop();
			}
		},
	);
};
