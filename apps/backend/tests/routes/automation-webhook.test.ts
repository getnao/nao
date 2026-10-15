import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock every dependency that would otherwise pull in bun:sqlite or the agent
// stack, so the route can be exercised in isolation under the node runner.
vi.mock('../../src/handlers/automation.handler', () => ({ startAutomationRun: vi.fn() }));
vi.mock('../../src/queries/automation.queries', () => ({ getAutomationById: vi.fn() }));
vi.mock('../../src/queries/project.queries', () => ({ getProjectById: vi.fn() }));
vi.mock('../../src/services/api-key.service', () => ({ validateApiKey: vi.fn() }));
vi.mock('../../src/services/cloud-billing-access.service', () => ({ assertProjectCloudBillingAccess: vi.fn() }));
vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

import { startAutomationRun } from '../../src/handlers/automation.handler';
import * as automationQueries from '../../src/queries/automation.queries';
import * as projectQueries from '../../src/queries/project.queries';
import { automationWebhookRoutes } from '../../src/routes/automation-webhook';
import { validateApiKey } from '../../src/services/api-key.service';
import { assertProjectCloudBillingAccess } from '../../src/services/cloud-billing-access.service';

const ORG = { id: 'org-1' };
const AUTOMATION_ID = 'automation-1';
const VALID_KEY_HEADERS = { authorization: 'Bearer nao_valid' };

function buildAutomation(overrides: Record<string, unknown> = {}) {
	return { id: AUTOMATION_ID, projectId: 'project-1', webhookEnabled: true, ...overrides };
}

async function post(app: FastifyInstance, headers: Record<string, string> = {}) {
	return app.inject({ method: 'POST', url: `/api/automations/${AUTOMATION_ID}/run`, headers });
}

function mockAuthorizedAutomation(automationOverrides: Record<string, unknown> = {}, projectOrgId = ORG.id) {
	vi.mocked(validateApiKey).mockResolvedValue(ORG as never);
	vi.mocked(automationQueries.getAutomationById).mockResolvedValue(buildAutomation(automationOverrides) as never);
	vi.mocked(projectQueries.getProjectById).mockResolvedValue({ id: 'project-1', orgId: projectOrgId } as never);
}

describe('automation webhook route', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		vi.clearAllMocks();
		app = Fastify();
		await app.register(automationWebhookRoutes, { prefix: '/api' });
		await app.ready();
	});

	afterEach(async () => {
		await app.close();
	});

	it('rejects requests without a bearer token', async () => {
		const res = await post(app);
		expect(res.statusCode).toBe(401);
		expect(vi.mocked(validateApiKey)).not.toHaveBeenCalled();
	});

	it('rejects an invalid api key', async () => {
		vi.mocked(validateApiKey).mockResolvedValue(null);
		const res = await post(app, { authorization: 'Bearer nao_invalid' });
		expect(res.statusCode).toBe(401);
	});

	it('returns 404 when the automation does not exist', async () => {
		vi.mocked(validateApiKey).mockResolvedValue(ORG as never);
		vi.mocked(automationQueries.getAutomationById).mockResolvedValue(null);
		const res = await post(app, VALID_KEY_HEADERS);
		expect(res.statusCode).toBe(404);
		expect(vi.mocked(startAutomationRun)).not.toHaveBeenCalled();
	});

	it('returns 404 when the api key belongs to a different organization', async () => {
		mockAuthorizedAutomation({}, 'other-org');
		const res = await post(app, VALID_KEY_HEADERS);
		expect(res.statusCode).toBe(404);
		expect(vi.mocked(startAutomationRun)).not.toHaveBeenCalled();
	});

	it('returns 403 when the webhook trigger is disabled', async () => {
		mockAuthorizedAutomation({ webhookEnabled: false });
		const res = await post(app, VALID_KEY_HEADERS);
		expect(res.statusCode).toBe(403);
		expect(vi.mocked(startAutomationRun)).not.toHaveBeenCalled();
	});

	it('returns 409 when the automation is paused', async () => {
		mockAuthorizedAutomation({ scheduledJob: { status: 'paused' }, enabled: false });
		const res = await post(app, VALID_KEY_HEADERS);
		expect(res.statusCode).toBe(409);
		expect(vi.mocked(startAutomationRun)).not.toHaveBeenCalled();
	});

	it('triggers a run for a valid, authorized webhook request', async () => {
		mockAuthorizedAutomation();
		vi.mocked(startAutomationRun).mockResolvedValue({ id: 'run-1', status: 'running' } as never);

		const res = await post(app, VALID_KEY_HEADERS);

		expect(res.statusCode).toBe(202);
		expect(res.json()).toEqual({ runId: 'run-1', automationId: AUTOMATION_ID, status: 'running' });
		expect(vi.mocked(assertProjectCloudBillingAccess)).toHaveBeenCalledWith('project-1');
		expect(vi.mocked(startAutomationRun)).toHaveBeenCalledWith(AUTOMATION_ID, {
			billingAccessVerifiedProjectId: 'project-1',
			requireEnabled: false,
		});
	});

	it('triggers a run for an enabled scheduled automation', async () => {
		mockAuthorizedAutomation({ scheduledJob: { status: 'pending' }, enabled: true });
		vi.mocked(startAutomationRun).mockResolvedValue({ id: 'run-2', status: 'running' } as never);

		const res = await post(app, VALID_KEY_HEADERS);

		expect(res.statusCode).toBe(202);
		expect(vi.mocked(startAutomationRun)).toHaveBeenCalledWith(AUTOMATION_ID, {
			billingAccessVerifiedProjectId: 'project-1',
			requireEnabled: false,
		});
	});
});
