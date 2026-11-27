import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	assertOrganizationCloudBillingAccess: vi.fn(),
	cancelAutomationRun: vi.fn(),
	failStaleAutomationRuns: vi.fn(),
	deleteProjectAutomation: vi.fn(),
	deleteJob: vi.fn(),
	getAutomation: vi.fn(),
	getProjectAutomation: vi.fn(),
	getAutomationById: vi.fn(),
	getChat: vi.fn(),
	getProjectAutomationRun: vi.fn(),
	hasTableAccessOf: vi.fn(),
	linkAutomationJob: vi.fn(),
	listProjectAutomations: vi.fn(),
	listShareableMembers: vi.fn(),
	listUsersWithProjectAccess: vi.fn(),
	setAutomationEventTriggers: vi.fn(),
	transferAutomationOwnership: vi.fn(),
	transferProjectAutomationsOfUser: vi.fn(),
	updateAutomation: vi.fn(),
	upsertRecurringJob: vi.fn(),
	roles: {} as Record<string, 'admin' | 'user' | 'viewer' | null>,
}));

vi.mock('../../src/env', () => ({ env: { BETA_AUTOMATIONS_ENABLED: true } }));
vi.mock('../../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/handlers/automation.handler', () => ({
	AUTOMATION_JOB_NAME: 'automation',
	startAutomationRun: vi.fn(),
}));
vi.mock('../../src/queries/automation.queries', () => ({
	automationJobUniqueKey: (id: string) => `automation:${id}`,
	cancelAutomationRun: mocks.cancelAutomationRun,
	failStaleAutomationRuns: mocks.failStaleAutomationRuns,
	deleteProjectAutomation: mocks.deleteProjectAutomation,
	getAutomation: mocks.getAutomation,
	getAutomationById: mocks.getAutomationById,
	getProjectAutomation: mocks.getProjectAutomation,
	getProjectAutomationRun: mocks.getProjectAutomationRun,
	linkAutomationJob: mocks.linkAutomationJob,
	listProjectAutomations: mocks.listProjectAutomations,
	setAutomationEventTriggers: mocks.setAutomationEventTriggers,
	transferAutomationOwnership: mocks.transferAutomationOwnership,
	transferProjectAutomationsOfUser: mocks.transferProjectAutomationsOfUser,
	updateAutomation: mocks.updateAutomation,
}));
vi.mock('../../src/queries/chat.queries', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/queries/chat.queries')>()),
	getChat: mocks.getChat,
}));
vi.mock('../../src/queries/scheduled-job.queries', () => ({
	deleteJob: mocks.deleteJob,
	upsertRecurringJob: mocks.upsertRecurringJob,
}));
vi.mock('../../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', name: 'Project', orgId: 'org-id' })),
	getUserRoleInProject: vi.fn(async (_projectId: string, userId: string) => mocks.roles[userId] ?? null),
	listUsersWithProjectAccess: mocks.listUsersWithProjectAccess,
}));
vi.mock('../../src/services/agent', () => ({ agentService: { get: vi.fn() } }));
vi.mock('../../src/services/project-sharing.service', () => ({ listShareableMembers: mocks.listShareableMembers }));
vi.mock('../../src/services/user-group-context-access.service', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/services/user-group-context-access.service')>()),
	hasTableAccessOf: mocks.hasTableAccessOf,
}));
vi.mock('../../src/services/cloud-billing-access.service', () => ({
	assertOrganizationCloudBillingAccess: mocks.assertOrganizationCloudBillingAccess,
	assertProjectCloudBillingAccess: vi.fn(),
}));

import { automationRoutes } from '../../src/trpc/automation.routes';
import { router } from '../../src/trpc/trpc';
import { createTestCaller } from '../helpers/trpc-caller';

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
	eventTriggers: {},
};

const feedbackAutomation = {
	id: 'feedback-id',
	userId: 'owner-id',
	cron: '',
	enabled: false,
	webhookEnabled: false,
	eventTriggers: { feedback: { enabled: true, votes: ['down'], sources: ['story'] } },
};

describe('automation admin routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.roles = { 'admin-id': 'admin', 'owner-id': 'user', 'viewer-id': 'viewer' };
		mocks.listUsersWithProjectAccess.mockResolvedValue([{ id: 'admin-id' }, { id: 'owner-id' }]);
		mocks.hasTableAccessOf.mockResolvedValue(true);
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
		expect(mocks.setAutomationEventTriggers).not.toHaveBeenCalled();
	});

	it('turns off the webhook trigger of a webhook-only automation', async () => {
		mocks.getProjectAutomation.mockResolvedValue(webhookAutomation);

		const result = await createCaller('admin-id').automation.setEnabledAsAdmin({
			id: 'webhook-id',
			enabled: false,
		});

		expect(mocks.setAutomationEventTriggers).toHaveBeenCalledWith('webhook-id', {
			webhookEnabled: false,
			eventTriggers: {},
		});
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
		expect(mocks.setAutomationEventTriggers).toHaveBeenCalledWith('webhook-id', {
			webhookEnabled: true,
			eventTriggers: {},
		});
		expect(result.webhookEnabled).toBe(true);
	});

	it('pauses and resumes the feedback trigger of a feedback-only automation', async () => {
		mocks.getProjectAutomation.mockResolvedValue(feedbackAutomation);
		const paused = await createCaller('admin-id').automation.setEnabledAsAdmin({
			id: 'feedback-id',
			enabled: false,
		});

		expect(mocks.setAutomationEventTriggers).toHaveBeenCalledWith('feedback-id', {
			webhookEnabled: false,
			eventTriggers: { feedback: { ...feedbackAutomation.eventTriggers.feedback, enabled: false } },
		});

		mocks.getProjectAutomation.mockResolvedValue(paused);
		const resumed = await createCaller('admin-id').automation.setEnabledAsAdmin({
			id: 'feedback-id',
			enabled: true,
		});

		expect(resumed.webhookEnabled).toBe(false);
		expect(resumed.eventTriggers).toEqual(feedbackAutomation.eventTriggers);
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
		await expect(
			createCaller('admin-id').automation.transferAllFromUser({
				fromUserId: 'owner-id',
				recipientId: 'viewer-id',
			}),
		).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Viewers cannot own automations.' });
		expect(mocks.transferAutomationOwnership).not.toHaveBeenCalled();
		expect(mocks.transferProjectAutomationsOfUser).not.toHaveBeenCalled();
	});

	it("refuses to transfer automations to a member missing some of the previous owner's tables", async () => {
		mocks.getProjectAutomation.mockResolvedValue(scheduledAutomation);
		mocks.hasTableAccessOf.mockResolvedValue(false);
		const missingTables = { code: 'BAD_REQUEST', message: expect.stringContaining('every table') };

		await expect(
			createCaller('admin-id').automation.transferOwnership({ id: 'scheduled-id', newOwnerId: 'admin-id' }),
		).rejects.toMatchObject(missingTables);
		await expect(
			createCaller('admin-id').automation.transferAllFromUser({
				fromUserId: 'owner-id',
				recipientId: 'admin-id',
			}),
		).rejects.toMatchObject(missingTables);
		expect(mocks.hasTableAccessOf).toHaveBeenCalledWith('project-id', 'owner-id', 'admin-id');
		expect(mocks.transferAutomationOwnership).not.toHaveBeenCalled();
		expect(mocks.transferProjectAutomationsOfUser).not.toHaveBeenCalled();
	});

	it("transfers all of a member's automations in the project to another member", async () => {
		mocks.transferProjectAutomationsOfUser.mockResolvedValue(2);

		await expect(
			createCaller('admin-id').automation.transferAllFromUser({
				fromUserId: 'owner-id',
				recipientId: 'admin-id',
			}),
		).resolves.toEqual({ transferredCount: 2 });

		expect(mocks.transferProjectAutomationsOfUser).toHaveBeenCalledWith('project-id', 'owner-id', 'admin-id');
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

describe('automation run threads', () => {
	const run = { id: 'run-id', automationId: 'scheduled-id', chatId: 'run-chat-id', status: 'completed' };
	const runInput = { automationId: 'scheduled-id', runId: 'run-id' };

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.roles = { 'owner-id': 'user', 'viewer-id': 'viewer', 'shared-user-id': 'user' };
		mocks.getProjectAutomationRun.mockResolvedValue(run);
		mocks.getChat.mockResolvedValue([{ id: 'run-chat-id', messages: [] }, 'owner-id']);
	});

	it('opens the thread of a run for someone the automation is shared with', async () => {
		mocks.getAutomation.mockResolvedValue({ ...scheduledAutomation, title: 'Daily report', accessRole: 'viewer' });

		const result = await createCaller('viewer-id').automation.getRunChat(runInput);

		expect(mocks.failStaleAutomationRuns).toHaveBeenCalled();
		expect(mocks.getProjectAutomationRun).toHaveBeenCalledWith('project-id', 'run-id');
		expect(mocks.getAutomation).toHaveBeenCalledWith('project-id', 'viewer-id', 'scheduled-id', 'viewer');
		expect(result).toMatchObject({
			automation: { id: 'scheduled-id', title: 'Daily report' },
			run: { id: 'run-id' },
			chat: { id: 'run-chat-id' },
		});
	});

	it.each([
		{
			case: 'the automation is not shared with them',
			automation: null,
			runPatch: {},
			automationId: 'scheduled-id',
		},
		{
			case: 'the run has no chat',
			automation: scheduledAutomation,
			runPatch: { chatId: null },
			automationId: 'scheduled-id',
		},
		{
			case: 'the run belongs to another automation',
			automation: scheduledAutomation,
			runPatch: {},
			automationId: 'other-id',
		},
	])('hides the thread when $case', async ({ automation, runPatch, automationId }) => {
		mocks.getAutomation.mockResolvedValue(automation);
		mocks.getProjectAutomationRun.mockResolvedValue({ ...run, ...runPatch });

		await expect(
			createCaller('viewer-id').automation.getRunChat({ ...runInput, automationId }),
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
		expect(mocks.getChat).not.toHaveBeenCalled();
	});

	it('lets only editors of the automation cancel its runs', async () => {
		mocks.getProjectAutomationRun.mockResolvedValue({ ...run, status: 'running' });
		mocks.getAutomation.mockImplementation(async (_projectId, _userId, _id, minimumRole: string) =>
			minimumRole === 'viewer' ? { ...scheduledAutomation, accessRole: 'viewer' } : null,
		);

		await expect(createCaller('shared-user-id').automation.cancelRun({ runId: 'run-id' })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
		expect(mocks.getAutomation).toHaveBeenCalledWith('project-id', 'shared-user-id', 'scheduled-id', 'editor');
		expect(mocks.cancelAutomationRun).not.toHaveBeenCalled();
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
		mocks.getAutomation.mockResolvedValue({ ...scheduledAutomation, accessRole: 'owner' });
		mocks.getAutomationById.mockResolvedValue(scheduledAutomation);
	});

	it('saves an automation that posts to several valid channels', async () => {
		await createCaller('owner-id').automation.update({
			...automationInput,
			integrations: { slack: { enabled: true, channelId: 'C0123456789, #data-alerts' } },
		});

		expect(mocks.updateAutomation).toHaveBeenCalledWith(
			'project-id',
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

describe('automation email recipients', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.roles = { 'owner-id': 'user', 'viewer-id': 'viewer' };
		mocks.listShareableMembers.mockResolvedValue([
			{ id: 'member-id', name: 'Ada', email: 'ada@example.com', role: 'user', status: 'active' },
		]);
	});

	it('lists the name and email of the members the caller can share with', async () => {
		const recipients = await createCaller('owner-id').automation.listEmailRecipients();

		expect(recipients).toEqual([{ email: 'ada@example.com', name: 'Ada' }]);
		expect(mocks.listShareableMembers).toHaveBeenCalledWith('project-id', 'owner-id');
	});

	it('hides the members from viewers, who cannot run automations', async () => {
		await expect(createCaller('viewer-id').automation.listEmailRecipients()).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(mocks.listShareableMembers).not.toHaveBeenCalled();
	});
});

function createCaller(userId: string) {
	return createTestCaller(testRouter, { userId });
}
