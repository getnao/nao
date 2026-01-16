import crypto from 'crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

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
	const rawBody = request.rawBody as string;
	const timestamp = request.headers['x-slack-request-timestamp'] as string;
	const signature = request.headers['x-slack-signature'] as string;

	if (!verifySlackSignature(process.env.SLACK_SIGNING_SECRET!, signature, timestamp, rawBody)) {
		return reply.status(403).send('Invalid signature');
	}
}
