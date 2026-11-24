import { createHmac, timingSafeEqual } from 'node:crypto';

import type { App } from '../app';
import { env } from '../env';
import { getProjectSlackConfig } from '../queries/project-slack-config.queries';
import * as slackInstallationQueries from '../queries/project-slack-installation.queries';
import { slackService } from '../services/slack';
import { logger } from '../utils/logger';
import { convertHeaders } from '../utils/utils';

export const slackRoutes = async (app: App) => {
	app.post('/', { config: { rawBody: true } }, async (request, reply) => {
		const rawBody = String(request.rawBody ?? '');
		const signingSecret = env.CLOUD_SLACK_OAUTH_SIGNING_SECRET;

		if (!signingSecret) {
			return reply.status(503).send('Slack OAuth is not configured');
		}

		const timestamp = getHeader(request.headers['x-slack-request-timestamp']);
		const signature = getHeader(request.headers['x-slack-signature']);

		if (!verifySlackSignature(rawBody, timestamp, signature, signingSecret)) {
			return reply.status(401).send('Invalid Slack signature');
		}

		const slackBody = parseSlackBody(rawBody, request.headers['content-type']);

		if (!slackBody) {
			return reply.status(400).send('Invalid Slack request');
		}

		if (slackBody.type === 'url_verification' && typeof slackBody.challenge === 'string') {
			return reply.type('text/plain').send(slackBody.challenge);
		}

		const teamId = extractSlackTeamId(slackBody);
		if (!teamId) {
			logger.warn('Signed Slack request did not contain a team ID.', {
				source: 'system',
			});
			return reply.status(200).send('ok');
		}

		const installation = await slackInstallationQueries.getSlackInstallationByTeamId(teamId);

		if (!installation) {
			logger.warn('Slack request received for an unknown workspace.', {
				source: 'system',
				context: { teamId },
			});
			return reply.status(200).send('ok');
		}

		const event = asRecord(slackBody.event);

		if (event?.type === 'app_uninstalled') {
			const eventTime = slackBody.event_time;

			if (typeof eventTime !== 'number' || eventTime * 1000 <= installation.updatedAt.getTime()) {
				return reply.status(200).send('ok');
			}

			const deleted = await slackInstallationQueries.deleteSlackInstallationIfCurrent(
				installation.projectId,
				teamId,
				installation.installationVersion,
			);

			if (deleted) {
				await slackService.stopProject(installation.projectId);
			}

			return reply.status(200).send('ok');
		}

		const slackConfig = await getProjectSlackConfig(installation.projectId);
		if (!slackConfig) {
			logger.error('Slack installation has no usable configuration.', {
				source: 'system',
				projectId: installation.projectId,
			});
			return reply.status(503).send('Slack configuration unavailable');
		}
		const webRequest = new Request(`http://localhost${request.url}`, {
			method: request.method,
			headers: convertHeaders(request.headers),
			body: rawBody,
		});
		const webhooks = await slackService.getWebhooks(slackConfig);
		if (!webhooks) {
			return reply.status(503).send('Slack adapter unavailable');
		}
		const response = await webhooks.slack(webRequest, {
			waitUntil: (task: Promise<unknown>) => task,
		});
		reply.status(response.status);
		response.headers.forEach((value, key) => reply.header(key, value));
		return reply.send(await response.text());
	});
	app.post('/:projectId', { config: { rawBody: true } }, async (request, reply) => {
		const { projectId } = request.params as { projectId: string };
		const webRequest = new Request(`http://localhost${request.url}`, {
			method: request.method,
			headers: convertHeaders(request.headers),
			body: request.rawBody as string,
		});

		const slackConfig = await getProjectSlackConfig(projectId);
		if (!slackConfig) {
			throw new Error('Slack configuration not found');
		}

		const webhooks = await slackService.getWebhooks(slackConfig);
		if (!webhooks) {
			throw new Error('Failed to initialize Slack webhooks');
		}
		const response = await webhooks.slack(webRequest, {
			waitUntil: (task: Promise<unknown>) => task,
		});

		reply.status(response.status);
		response.headers.forEach((value, key) => reply.header(key, value));
		return reply.send(await response.text());
	});
};

function verifySlackSignature(
	rawBody: string,
	timestampHeader: string | undefined,
	signatureHeader: string | undefined,
	signingSecret: string,
): boolean {
	if (!timestampHeader || !signatureHeader) {
		return false;
	}

	const timestamp = Number(timestampHeader);
	if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 5 * 60) {
		return false;
	}

	const expectedSignature = `v0=${createHmac('sha256', signingSecret)
		.update(`v0:${timestampHeader}:${rawBody}`)
		.digest('hex')}`;

	const actualBuffer = Buffer.from(signatureHeader);
	const expectedBuffer = Buffer.from(expectedSignature);

	return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function parseSlackBody(rawBody: string, contentType: string | undefined): Record<string, unknown> | null {
	try {
		if (contentType?.includes('application/json')) {
			return asRecord(JSON.parse(rawBody));
		}

		if (contentType?.includes('application/x-www-form-urlencoded')) {
			const parameters = new URLSearchParams(rawBody);
			const interactivePayload = parameters.get('payload');

			if (interactivePayload) {
				return asRecord(JSON.parse(interactivePayload));
			}

			return Object.fromEntries(parameters);
		}
	} catch {
		return null;
	}

	return null;
}

function extractSlackTeamId(body: Record<string, unknown>): string | null {
	if (typeof body.team_id === 'string') {
		return body.team_id;
	}

	const team = asRecord(body.team);
	return typeof team?.id === 'string' ? team.id : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function getHeader(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}
