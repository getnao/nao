import crypto from 'crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { getProjectByPath, getProjectSlackConfig } from '../queries/project.queries';

function verifySlackSignature(signingSecret: string, requestSignature: string, timestamp: string, rawBody: string) {
	const currentTime = Math.floor(Date.now() / 1000);
	if (Math.abs(currentTime - parseInt(timestamp)) > 300) {
		return false;
	}

	const sigBasestring = `v0:${timestamp}:${rawBody}`;
	const mySignature = 'v0=' + crypto.createHmac('sha256', signingSecret).update(sigBasestring).digest('hex');

	return crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(requestSignature));
}

export interface SlackConfig {
	projectId: string;
	botToken: string;
	signingSecret: string;
	redirectUrl: string;
}

/**
 * Get Slack configuration from project config with env var fallbacks.
 * This is the single source of truth for all Slack config values.
 */
export async function getSlackConfig(): Promise<SlackConfig | null> {
	const projectPath = process.env.NAO_DEFAULT_PROJECT_PATH;
	if (!projectPath) {
		return null;
	}

	const project = await getProjectByPath(projectPath);
	if (!project) {
		return null;
	}

	const dbConfig = await getProjectSlackConfig(project.id);

	const botToken = dbConfig?.botToken || process.env.SLACK_BOT_TOKEN;
	const signingSecret = dbConfig?.signingSecret || process.env.SLACK_SIGNING_SECRET;
	const redirectUrl = process.env.REDIRECT_URL || 'http://localhost:3000/';

	if (!botToken || !signingSecret) {
		return null;
	}

	const baseUrl = redirectUrl.endsWith('/') ? redirectUrl.slice(0, -1) : redirectUrl;

	return {
		projectId: project.id,
		botToken,
		signingSecret,
		redirectUrl: `${baseUrl}/p/${project.id}/`,
	};
}

export async function slackAuthMiddleware(request: FastifyRequest, reply: FastifyReply) {
	const rawBody = request.rawBody;
	const timestamp = request.headers['x-slack-request-timestamp'];
	const signature = request.headers['x-slack-signature'];

	const slackConfig = await getSlackConfig();

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
