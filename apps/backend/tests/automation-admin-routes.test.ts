import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	assertOrganizationCloudBillingAccess: vi.fn(),
	deleteProjectAutomation: vi.fn(),
	deleteJob: vi.fn(),
	getProjectAutomation: vi.fn(),
	getAutomationById: vi.fn(),
	linkAutomationJob: vi.fn(),
	listProjectAutomations: vi.fn(),
	listUsersWithProjectAccess: vi.fn(),
	setAutomationWebhookEnabled: vi.fn(),
	transferAutomationOwnership: vi.fn(),
	updateAutomation: vi.fn(),
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
	deleteProjectAutomation: mocks.deleteProjectAutomation,
	getAutomationById: mocks.getAutomationById,
	getProjectAutomation: mocks.getProjectAutomation,
	linkAutomationJob: mocks.linkAutomationJob,
	listProjectAutomations: mocks.listProjectAutomations,
	setAutomationWebhookEnabled: mocks.setAutomationWebhookEnabled,
	transferAutomationOwnership: mocks.transferAutomationOwnership,
	updateAutomation: mocks.updateAutomation,
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
	assertOrganizationCloudBillingAccess: mocks.assertOrganizationCloudBillingAccess,
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

	it('resumes the schedule of a paused automation after checking billing access', async () => {
		mocks.getProjectAutomation.mockResolvedValue({ ...scheduledAutomation, enabled: false });

		await createCaller('admin-id').automation.setEnabledAsAdmin({ id: 'scheduled-id', enabled: true });

		expect(mocks.assertOrganizationCloudBillingAccess).toHaveBeenCalledWith('org-id');
		expect(mocks.upsertRecurringJob).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
	});

	it('turns the webhook trigger back on for a disabled webhook-only automation', async () => {
		mocks.getProjectAutomation.mockResolvedValue({ ...webhookAutomation, webhookEnabled: false });

		const result = await createCaller('admin-id').automation.setEnabledAsAdmin({ id: 'webhook-id', enabled: true });

		expect(mocks.assertOrganizationCloudBillingAccess).toHaveBeenCalledWith('org-id');
		expect(mocks.setAutomationWebhookEnabled).toHaveBeenCalledWith('webhook-id', true);
		expect(result.webhookEnabled).toBe(true);
	});

	it('refuses to enable an automation without billing access', async () => {
		mocks.assertOrganizationCloudBillingAccess.mockRejectedValueOnce(
			new TRPCError({ code: 'FORBIDDEN', message: 'Cloud billing access is restricted' }),
		);
		mocks.getProjectAutomation.mockResolvedValue({ ...scheduledAutomation, enabled: false });

		await expect(
			createCaller('admin-id').automation.setEnabledAsAdmin({ id: 'scheduled-id', enabled: true }),
		).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Cloud billing access is restricted' });
		expect(mocks.upsertRecurringJob).not.toHaveBeenCalled();
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
		expect(mocks.deleteProjectAutomation).toHaveBeenCalledWith('project-id', 'scheduled-id');
	});

	it('does not delete automations outside the project', async () => {
		mocks.getProjectAutomation.mockResolvedValue(null);

		await createCaller('admin-id').automation.deleteAsAdmin({ id: 'other-id' });

		expect(mocks.deleteJob).not.toHaveBeenCalled();
		expect(mocks.deleteProjectAutomation).not.toHaveBeenCalled();
	});

	it('restricts deletion of other users automations to project admins', async () => {
		await expect(createCaller('owner-id').automation.deleteAsAdmin({ id: 'scheduled-id' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(mocks.deleteProjectAutomation).not.toHaveBeenCalled();
	});
});

describe('automation Slack channel validation', () => {
	const automationInput = {
		id: 'scheduled-id',
		title: 'Weekly report',
		prompt: 'Send the weekly report',
		cron: '0 9 * * *',
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.roles = { 'owner-id': 'user' };
		mocks.upsertRecurringJob.mockResolvedValue({ id: 'job-id' });
		mocks.updateAutomation.mockResolvedValue(scheduledAutomation);
		mocks.getAutomationById.mockResolvedValue(scheduledAutomation);
	});

	it('saves an automation that posts to several valid channels', async () => {
		await createCaller('owner-id').automation.update({
			...automationInput,
			integrations: { slack: { enabled: true, channelId: 'C0123456789, #data-alerts' } },
		});

		expect(mocks.updateAutomation).toHaveBeenCalledWith(
			'project-id',
			'owner-id',
			'scheduled-id',
			expect.objectContaining({
				integrations: { slack: { enabled: true, channelId: 'C0123456789, #data-alerts' } },
			}),
		);
	});

	it('rejects malformed channels before saving', async () => {
		await expect(
			createCaller('owner-id').automation.update({
				...automationInput,
				integrations: { slack: { enabled: true, channelId: 'C0123456789, sales team, C12' } },
			}),
		).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('Fix or remove 2 malformed Slack channels before saving.'),
		});
		expect(mocks.updateAutomation).not.toHaveBeenCalled();
	});

	it('ignores the channels of a disabled Slack integration', async () => {
		await createCaller('owner-id').automation.update({
			...automationInput,
			integrations: { slack: { enabled: false, channelId: 'sales team' } },
		});

		expect(mocks.updateAutomation).toHaveBeenCalled();
	});
});

function createCaller(userId: string) {
	return testRouter.createCaller({
		session: { user: { id: userId, name: 'Test User', email: `${userId}@example.com` } },
		selectedProjectId: 'project-id',
	} as never);
}
