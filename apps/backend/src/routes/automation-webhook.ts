import type { App } from '../app';
import { env } from '../env';
import { startAutomationRun } from '../handlers/automation.handler';
import * as automationQueries from '../queries/automation.queries';
import * as projectQueries from '../queries/project.queries';
import { validateApiKey } from '../services/api-key.service';
import { logger } from '../utils/logger';

/**
 * Webhook trigger for automations. Authenticated with an organization API key
 * (the same credential used by `nao deploy`): `Authorization: Bearer nao_...`.
 * The key's organization must own the automation's project, and the automation
 * must have its webhook trigger enabled.
 */
export const automationWebhookRoutes = async (app: App) => {
	app.post('/automations/:automationId/run', async (request, reply) => {
		if (!env.BETA_AUTOMATIONS_ENABLED) {
			return reply.status(404).send({ error: 'Automations are disabled on this instance.' });
		}

		const authHeader = request.headers.authorization;
		if (!authHeader?.startsWith('Bearer ')) {
			return reply.status(401).send({ error: 'Missing or invalid Authorization header' });
		}

		const org = await validateApiKey(authHeader.slice(7));
		if (!org) {
			return reply.status(401).send({ error: 'Invalid API key' });
		}

		const { automationId } = request.params as { automationId: string };
		const automation = await automationQueries.getAutomationById(automationId);
		const project = automation ? await projectQueries.getProjectById(automation.projectId) : null;
		if (!automation || !project || project.orgId !== org.id) {
			return reply.status(404).send({ error: 'Automation not found' });
		}

		if (!automation.webhookEnabled) {
			return reply.status(403).send({ error: 'Webhook trigger is not enabled for this automation' });
		}

		// A paused automation stops answering all of its triggers, including the
		// webhook. Pausing only applies to automations with a schedule — the
		// derived `enabled` flag is always false when there is no scheduled job.
		if (automation.scheduledJob && !automation.enabled) {
			return reply.status(409).send({ error: 'Automation is paused' });
		}

		const run = await startAutomationRun(automationId, { requireEnabled: false });
		logger.info('Automation webhook triggered run', {
			source: 'http',
			projectId: automation.projectId,
			context: { automationId, runId: run.id, orgId: org.id },
		});

		return reply.status(202).send({ runId: run.id, automationId, status: run.status });
	});
};
