import { WebClient } from '@slack/web-api';

import { generateResponse } from '../agents/agentService';
import type { App } from '../app';
import { slackAuthMiddleware } from '../middleware/auth';

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

export const slackRoutes = async (app: App) => {
	app.addHook('preHandler', slackAuthMiddleware);

	app.post('/app_mention', { config: { rawBody: true } }, async (request, reply) => {
		const body = request.body as any;

		if (body.type === 'url_verification') {
			return reply.send({ challenge: body.challenge });
		}

		const text = (body.event?.text ?? '').replace(/<@[A-Z0-9]+>/gi, '').trim();
		const channel = body.event?.channel;

		if (!text || !channel) {
			return reply.send({ ok: false, error: 'missing_text_or_channel' });
		}

		// Acknowledge the event within 3 seconds limit
		reply.send({ ok: true });

		const responseText = await generateResponse(text);

		try {
			await slackClient.chat.postMessage({
				channel: channel,
				text: responseText,
				thread_ts: body.event?.ts,
			});
		} catch (error) {
			console.error('Erreur:', error);
		}
	});
};
