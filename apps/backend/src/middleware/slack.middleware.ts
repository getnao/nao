import crypto from 'crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

import * as slackConfigQueries from '../queries/project-slack-config.queries';

function verifySlackSignature(signingSecret: string, requestSignature: string, timestamp: string, rawBody: string) {
	const currentTime = Math.floor(Date.now() / 1000);
	if (Math.abs(currentTime - parseInt(timestamp)) > 300) {
		return false;
	}

	const sigBasestring = `v0:${timestamp}:${rawBody}`;
	const mySignature = 'v0=' + crypto.createHmac('sha256', signingSecret).update(sigBasestring).digest('hex');

	return crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(requestSignature));
}

export async function slackAuthMiddleware(request: FastifyRequest, reply: FastifyReply) {
	const rawBody = request.rawBody;
	const timestamp = request.headers['x-slack-request-timestamp'];
	const signature = request.headers['x-slack-signature'];

	const slackConfig = await slackConfigQueries.getSlackConfig();

	if (!slackConfig) {
		return reply.status(400).send('Slack is not configured');
	}

	if (!rawBody || !timestamp || !signature) {
		return reply.status(400).send('Missing required headers or body');
	}

	if (typeof rawBody !== 'string' || typeof timestamp !== 'string' || typeof signature !== 'string') {
		return reply.status(400).send('Invalid types for headers or body');
	}

	if (!verifySlackSignature(slackConfig.signingSecret, signature, timestamp, rawBody)) {
		return reply.status(403).send('Invalid signature');
	}
}
