import type { Session, User } from 'better-auth';
import crypto from 'crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { auth } from '../auth';
import { convertHeaders } from '../utils/utils';

declare module 'fastify' {
	interface FastifyRequest {
		user: User;
		session: Session;
	}
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
	const headers = convertHeaders(request.headers);
	const session = await auth.api.getSession({ headers });
	if (!session?.user) {
		return reply.status(401).send({ error: 'Unauthorized' });
	}

	request.user = session.user;
	request.session = session.session;
}

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
