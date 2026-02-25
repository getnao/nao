import crypto from 'crypto';
import type { FastifyRequest } from 'fastify';

import * as slackConfigQueries from '../queries/project-slack-config.queries';
import { HandlerError } from '../utils/error';

function verifySlackSignature(signingSecret: string, requestSignature: string, timestamp: string, rawBody: string) {
	const currentTime = Math.floor(Date.now() / 1000);
	if (Math.abs(currentTime - parseInt(timestamp)) > 300) {
		return false;
	}

	const sigBasestring = `v0:${timestamp}:${rawBody}`;
	const mySignature = 'v0=' + crypto.createHmac('sha256', signingSecret).update(sigBasestring).digest('hex');

	return crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(requestSignature));
}

export async function slackAuthMiddleware(request: FastifyRequest) {
	const rawBody = request.rawBody;
	const timestamp = request.headers['x-slack-request-timestamp'];
	const signature = request.headers['x-slack-signature'];

	const slackConfig = await slackConfigQueries.getSlackConfig();

	if (!slackConfig) {
		throw new HandlerError('BAD_REQUEST', 'Slack is not configured');
	}

	if (!rawBody || !timestamp || !signature) {
		throw new HandlerError('BAD_REQUEST', 'Missing required headers or body');
	}

	if (typeof rawBody !== 'string' || typeof timestamp !== 'string' || typeof signature !== 'string') {
		throw new HandlerError('BAD_REQUEST', 'Invalid types for headers or body');
	}

	if (!verifySlackSignature(slackConfig.signingSecret, signature, timestamp, rawBody)) {
		throw new HandlerError('FORBIDDEN', 'Invalid signature');
	}
}
