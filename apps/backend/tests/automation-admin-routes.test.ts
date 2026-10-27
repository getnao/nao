import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	deleteAutomation: vi.fn(),
	deleteJob: vi.fn(),
	getProjectAutomation: vi.fn(),
	getAutomationById: vi.fn(),
	linkAutomationJob: vi.fn(),
	listProjectAutomations: vi.fn(),
	listUsersWithProjectAccess: vi.fn(),
	setAutomationWebhookEnabled: vi.fn(),
	transferAutomationOwnership: vi.fn(),
	upsertRecurringJob: vi.fn(),
	roles: {} as Record<string, 'admin' | 'user' | 'viewer' | null>,
}));

vi.mock('../src/env', () => ({ env: { BETA_AUTOMATIONS_ENABLED: true } }));
vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/handlers/automation.handler', () => ({
	AUTOMATION_JOB_NAME: 'automation',
	startAutomationRun: vi.fn(),
}));
vi.mock('../src/queries/automation.queries', () => ({
	automationJobUniqueKey: (id: string) => `automation:${id}`,
	deleteAutomation: mocks.deleteAutomation,
	getAutomationById: mocks.getAutomationById,
	getProjectAutomation: mocks.getProjectAutomation,
	linkAutomationJob: mocks.linkAutomationJob,
	listProjectAutomations: mocks.listProjectAutomations,
	setAutomationWebhookEnabled: mocks.setAutomationWebhookEnabled,
	transferAutomationOwnership: mocks.transferAutomationOwnership,
}));
vi.mock('../src/queries/scheduled-job.queries', () => ({
	deleteJob: mocks.deleteJob,
	upsertRecurringJob: mocks.upsertRecurringJob,
}));
vi.mock('../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', name: 'Project', orgId: 'org-id' })),
	getUserRoleInProject: vi.fn(async (_projectId: string, userId: string) => mocks.roles[userId] ?? null),
	listUsersWithProjectAccess: mocks.listUsersWithProjectAccess,
}));
vi.mock('../src/services/agent', () => ({ agentService: { get: vi.fn() } }));
vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertOrganizationCloudBillingAccess: vi.fn(),
	assertProjectCloudBillingAccess: vi.fn(),
}));

import { automationRoutes } from '../src/trpc/automation.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router({ automation: automationRoutes });

const scheduledAutomation = {
	id: 'scheduled-id',
	projectId: 'project-id',
	userId: 'owner-id',
	scheduledJobId: 'job-id',
	cron: '0 9 * * *',
	enabled: true,
	webhookEnabled: false,
};

const webhookAutomation = {
	id: 'webhook-id',
	userId: 'owner-id',
	cron: '',
	enabled: false,
	webhookEnabled: true,
};

describe('automation admin routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.roles = { 'admin-id': 'admin', 'owner-id': 'user', 'viewer-id': 'viewer' };
		mocks.listUsersWithProjectAccess.mockResolvedValue([{ id: 'admin-id' }, { id: 'owner-id' }]);
		mocks.upsertRecurringJob.mockResolvedValue({ id: 'job-id' });
		mocks.getAutomationById.mockImplementation(async (id: string) => ({ ...scheduledAutomation, id }));
	});

	it('restricts the admin automation routes to project admins', async () => {
		await expect(createCaller('owner-id').automation.listAllForAdmin()).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(mocks.listProjectAutomations).not.toHaveBeenCalled();
	});

	it('flags automations whose owner no longer has access to the project', async () => {
		mocks.listProjectAutomations.mockResolvedValue([
			{ id: 'kept', owner: { id: 'owner-id', name: 'Owner', email: 'owner@example.com' } },
			{ id: 'removed', owner: { id: 'removed-id', name: 'Removed', email: 'removed@example.com' } },
			{ id: 'deleted', owner: null },
		]);

		const automations = await createCaller('admin-id').automation.listAllForAdmin();

		expect(mocks.listProjectAutomations).toHaveBeenCalledWith('project-id');
		expect(automations.map(({ id, ownerHasProjectAccess }) => ({ id, ownerHasProjectAccess }))).toEqual([
			{ id: 'kept', ownerHasProjectAccess: true },
			{ id: 'removed', ownerHasProjectAccess: false },
			{ id: 'deleted', ownerHasProjectAccess: false },
		]);
	});

	it('pauses the schedule of a scheduled automation owned by another user', async () => {
		mocks.getProjectAutomation.mockResolvedValue(scheduledAutomation);

		await createCaller('admin-id').automation.setEnabledAsAdmin({ id: 'scheduled-id', enabled: false });

		expect(mocks.getProjectAutomation).toHaveBeenCalledWith('project-id', 'scheduled-id');
		expect(mocks.upsertRecurringJob).toHaveBeenCalledWith(expect.objectContaining({ status: 'paused' }));
		expect(mocks.setAutomationWebhookEnabled).not.toHaveBeenCalled();
	});

	it('turns off the webhook trigger of a webhook-only automation', async () => {
		mocks.getProjectAutomation.mockResolvedValue(webhookAutomation);

		const result = await createCaller('admin-id').automation.setEnabledAsAdmin({
			id: 'webhook-id',
			enabled: false,
		});

		expect(mocks.setAutomationWebhookEnabled).toHaveBeenCalledWith('webhook-id', false);
		expect(mocks.upsertRecurringJob).not.toHaveBeenCalled();
		expect(result.webhookEnabled).toBe(false);
	});

	it('rejects admin actions on automations outside the project', async () => {
		mocks.getProjectAutomation.mockResolvedValue(null);

		await expect(
			createCaller('admin-id').automation.setEnabledAsAdmin({ id: 'other-id', enabled: false }),
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
		await expect(
			createCaller('admin-id').automation.transferOwnership({ id: 'other-id', newOwnerId: 'admin-id' }),
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
	});

	it('transfers ownership to a project member who can run automations', async () => {
		mocks.getProjectAutomation.mockResolvedValue(scheduledAutomation);

		await expect(
			createCaller('admin-id').automation.transferOwnership({ id: 'scheduled-id', newOwnerId: 'admin-id' }),
		).resolves.toEqual({ success: true });

		expect(mocks.transferAutomationOwnership).toHaveBeenCalledWith('scheduled-id', 'admin-id');
	});

	it('refuses to transfer ownership to viewers or users outside the project', async () => {
		mocks.getProjectAutomation.mockResolvedValue(scheduledAutomation);

		await expect(
			createCaller('admin-id').automation.transferOwnership({ id: 'scheduled-id', newOwnerId: 'viewer-id' }),
		).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Viewers cannot own automations.' });
		await expect(
			createCaller('admin-id').automation.transferOwnership({ id: 'scheduled-id', newOwnerId: 'stranger-id' }),
		).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'The new owner must have access to this project.' });
		expect(mocks.transferAutomationOwnership).not.toHaveBeenCalled();
	});

	it("deletes another user's automation along with its schedule", async () => {
		mocks.getProjectAutomation.mockResolvedValue(scheduledAutomation);

		await expect(createCaller('admin-id').automation.deleteAsAdmin({ id: 'scheduled-id' })).resolves.toEqual({
			success: true,
		});

		expect(mocks.getProjectAutomation).toHaveBeenCalledWith('project-id', 'scheduled-id');
		expect(mocks.deleteJob).toHaveBeenCalledWith('job-id');
		expect(mocks.deleteAutomation).toHaveBeenCalledWith('project-id', 'owner-id', 'scheduled-id');
	});

	it('does not delete automations outside the project', async () => {
		mocks.getProjectAutomation.mockResolvedValue(null);

		await createCaller('admin-id').automation.deleteAsAdmin({ id: 'other-id' });

		expect(mocks.deleteJob).not.toHaveBeenCalled();
		expect(mocks.deleteAutomation).not.toHaveBeenCalled();
	});

	it('restricts deletion of other users automations to project admins', async () => {
		await expect(createCaller('owner-id').automation.deleteAsAdmin({ id: 'scheduled-id' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(mocks.deleteAutomation).not.toHaveBeenCalled();
	});
});

function createCaller(userId: string) {
	return testRouter.createCaller({
		session: { user: { id: userId, name: 'Test User', email: `${userId}@example.com` } },
		selectedProjectId: 'project-id',
	} as never);
}
