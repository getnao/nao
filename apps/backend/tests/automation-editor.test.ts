import type { AutomationDraft } from '@nao/shared/automation-draft';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as EnvModule from '../src/env';
import type * as ChatQueriesModule from '../src/queries/chat.queries';

const mocks = vi.hoisted(() => ({
	assertProjectCloudBillingAccess: vi.fn(),
	assertUserGroupFeature: vi.fn(),
	getAutomation: vi.fn(),
	getAutomationRunHistory: vi.fn(),
	getChatProjectId: vi.fn(),
	getForkMetadata: vi.fn(),
	getServersStatus: vi.fn(),
	getUserRoleInProject: vi.fn(),
	isOnboardingChat: vi.fn(),
}));

vi.mock('../src/env', async (importOriginal) => {
	const actual = await importOriginal<typeof EnvModule>();
	return { ...actual, env: { ...actual.env, BETA_AUTOMATIONS_ENABLED: true } };
});
vi.mock('../src/queries/project.queries', () => ({ getUserRoleInProject: mocks.getUserRoleInProject }));
vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertProjectCloudBillingAccess: mocks.assertProjectCloudBillingAccess,
}));
vi.mock('../src/services/user-group-feature-access.service', async (importOriginal) => ({
	...(await importOriginal<object>()),
	assertUserGroupFeature: mocks.assertUserGroupFeature,
}));
vi.mock('../src/services/mcp', () => ({ mcpService: { getServersStatus: mocks.getServersStatus } }));
vi.mock('../src/queries/automation.queries', () => ({
	getAutomation: mocks.getAutomation,
	getAutomationRunHistory: mocks.getAutomationRunHistory,
}));
vi.mock('../src/queries/chat.queries', async (importOriginal) => ({
	...(await importOriginal<typeof ChatQueriesModule>()),
	getChatProjectId: mocks.getChatProjectId,
	getForkMetadata: mocks.getForkMetadata,
	isOnboardingChat: mocks.isOnboardingChat,
}));

import { analyticsAgent } from '../src/agents/profiles/analytics';
import { authorizeAgentRun } from '../src/services/agent-run';
import { buildAutomationDraftUpdate, createAutomationEditorTools } from '../src/services/automation-editor-tools';
import type { AgentRequest } from '../src/types/chat';

const DRAFT: AutomationDraft = {
	title: 'Weekly revenue',
	prompt: 'Summarize last week revenue by country.',
	cron: '',
	webhookEnabled: false,
	eventTriggers: {},
	mcpEnabled: false,
	integrations: { email: { enabled: true, recipients: ['me@example.com'] } },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runTool(tools: Record<string, any>, name: string, input: Record<string, unknown> = {}) {
	return tools[name].execute(input, { experimental_context: {}, toolCallId: 'call-1', messages: [] });
}

describe('buildAutomationDraftUpdate', () => {
	it('keeps only the fields to change', () => {
		expect(buildAutomationDraftUpdate(DRAFT, { title: 'Daily revenue', webhook_enabled: true })).toEqual({
			title: 'Daily revenue',
			webhookEnabled: true,
		});
	});

	it('sets and removes the schedule', () => {
		expect(
			buildAutomationDraftUpdate(DRAFT, { schedule: { cron: '0 8 * * 1-5', description: 'Weekdays at 8am' } }),
		).toEqual({ cron: '0 8 * * 1-5', scheduleDescription: 'Weekdays at 8am' });
		expect(buildAutomationDraftUpdate(DRAFT, { remove_schedule: true })).toEqual({
			cron: '',
			scheduleDescription: '',
		});
	});

	it.each(['every monday', '0 0 8 * * 1', '99 8 * * 1'])('rejects the cron expression %j', (cron) => {
		expect(() => buildAutomationDraftUpdate(DRAFT, { schedule: { cron, description: 'Mondays' } })).toThrow(
			/cron expression/,
		);
	});

	it('rejects setting and removing the schedule at once', () => {
		expect(() =>
			buildAutomationDraftUpdate(DRAFT, {
				schedule: { cron: '0 8 * * 1', description: 'Mondays' },
				remove_schedule: true,
			}),
		).toThrow('not both');
	});

	it('keeps the current email recipients unless new ones are given', () => {
		expect(buildAutomationDraftUpdate(DRAFT, { email: { enabled: true, subject: 'Revenue' } })).toEqual({
			integrations: { email: { enabled: true, recipients: ['me@example.com'], subject: 'Revenue' } },
		});
	});

	it('rejects email delivery without valid recipients', () => {
		const withoutEmail = { ...DRAFT, integrations: {} };
		expect(() => buildAutomationDraftUpdate(withoutEmail, { email: { enabled: true } })).toThrow(
			'at least one recipient',
		);
		expect(() => buildAutomationDraftUpdate(DRAFT, { email: { enabled: true, recipients: ['nope'] } })).toThrow(
			'Invalid email recipients: nope.',
		);
	});

	it('validates and formats the Slack channels', () => {
		expect(
			buildAutomationDraftUpdate(DRAFT, { slack: { enabled: true, channels: ['#sales', 'C0123456789'] } }),
		).toEqual({ integrations: { slack: { enabled: true, channelId: '#sales, C0123456789' } } });
		expect(() =>
			buildAutomationDraftUpdate(DRAFT, { slack: { enabled: true, channels: ['sales team'] } }),
		).toThrow();
	});

	it('rejects an empty change', () => {
		expect(() => buildAutomationDraftUpdate(DRAFT, {})).toThrow('Nothing to change');
	});
});

describe('createAutomationEditorTools', () => {
	beforeEach(() => {
		mocks.getAutomationRunHistory.mockReset().mockResolvedValue([]);
	});

	it('reads the automation as changed earlier in the same run', async () => {
		const tools = createAutomationEditorTools({ draft: DRAFT, automationId: null, canUseChatFeedback: true });

		const before = await runTool(tools, 'get_automation');
		expect(before.missingBeforeSave).toEqual(['a trigger: a schedule, the webhook or the feedback trigger']);

		const result = await runTool(tools, 'update_automation', {
			schedule: { cron: '0 9 * * 1', description: 'Every Monday at 9am' },
		});
		expect(result.changedFields).toEqual(['schedule']);
		expect(result.update).toEqual({ cron: '0 9 * * 1', scheduleDescription: 'Every Monday at 9am' });

		const after = await runTool(tools, 'get_automation');
		expect(after.missingBeforeSave).toEqual([]);
		expect(after.schedule).toMatchObject({ cron: '0 9 * * 1', description: 'Every Monday at 9am' });
		expect(after.schedule.upcomingRuns).toHaveLength(3);
		expect(after.schedule.upcomingRuns[0]).toMatch(/^Monday/);
	});

	it('sets the feedback trigger, counting it as a trigger before saving', async () => {
		const tools = createAutomationEditorTools({ draft: DRAFT, automationId: null, canUseChatFeedback: true });

		const result = await runTool(tools, 'update_automation', { feedback_trigger: { enabled: true } });
		expect(result.changedFields).toEqual(['feedback']);
		expect(result.update).toEqual({
			eventTriggers: { feedback: { enabled: true, votes: ['down'], sources: ['chat', 'story'] } },
		});

		const after = await runTool(tools, 'get_automation');
		expect(after.naoEvents.feedback).toEqual({ votes: ['down'], sources: ['chat', 'story'] });
		expect(after.missingBeforeSave).toEqual([]);

		const removed = await runTool(tools, 'update_automation', { feedback_trigger: { enabled: false } });
		expect(removed.update).toEqual({ eventTriggers: {} });
	});

	it('keeps chat feedback to admins and context admins', () => {
		const update = { feedback_trigger: { enabled: true } };
		expect(buildAutomationDraftUpdate(DRAFT, update, { canUseChatFeedback: false })).toEqual({
			eventTriggers: { feedback: { enabled: true, votes: ['down'], sources: ['story'] } },
		});
		expect(() =>
			buildAutomationDraftUpdate(
				DRAFT,
				{ feedback_trigger: { enabled: true, sources: ['chat'] } },
				{ canUseChatFeedback: false },
			),
		).toThrow('Only admins and context admins');
	});

	it('describes the MCP servers a run can use, with their tools and status', async () => {
		mocks.getServersStatus.mockResolvedValue([
			{
				name: 'monday',
				enabled: true,
				discovered: true,
				oauth: true,
				oauthConnected: true,
				specPath: '/agent/mcps/monday',
				tools: [
					{ name: 'create_item', description: 'Create an item on a board', enabled: true },
					{ name: 'delete_board', description: 'Delete a board', enabled: false },
				],
			},
			{
				name: 'linear',
				enabled: true,
				discovered: true,
				oauth: true,
				oauthConnected: false,
				specPath: '',
				tools: [],
			},
		]);
		const draft = { ...DRAFT, mcpEnabled: true, mcpServers: ['monday', 'notion'] };
		const tools = createAutomationEditorTools({ draft, automationId: null, canUseChatFeedback: true });

		const automation = await tools.get_automation.execute(
			{},
			{ experimental_context: { projectId: 'project-1', userId: 'user-1', mcpAccess: { mode: 'all' } } },
		);

		expect(mocks.getServersStatus).toHaveBeenCalledWith('project-1', 'user-1', { mode: 'all' });
		expect(automation.mcp).toEqual({
			enabled: true,
			selection: 'selected servers',
			servers: [
				{
					name: 'monday',
					status: 'ready',
					specFolder: '/agent/mcps/monday',
					tools: [{ name: 'create_item', description: 'Create an item on a board' }],
				},
				{ name: 'notion', status: 'not_available', specFolder: '', tools: [] },
			],
		});
	});

	it('only looks up past runs of a saved automation', async () => {
		expect(
			createAutomationEditorTools({ draft: DRAFT, automationId: null, canUseChatFeedback: true }),
		).not.toHaveProperty('get_automation_run_history');

		const tools = createAutomationEditorTools({
			draft: DRAFT,
			automationId: 'automation-1',
			canUseChatFeedback: true,
		});
		await runTool(tools, 'get_automation_run_history', { limit: 3 });
		expect(mocks.getAutomationRunHistory).toHaveBeenCalledWith('automation-1', { limit: 3 });
	});
});

describe('automation editor runs', () => {
	const requestWithDraft = {
		message: { text: 'Run it daily' },
		mode: 'default',
		chatId: 'chat-1',
		automationDraft: DRAFT,
	};

	beforeEach(() => {
		mocks.assertProjectCloudBillingAccess.mockReset().mockResolvedValue(undefined);
		mocks.assertUserGroupFeature.mockReset().mockResolvedValue(undefined);
		mocks.getAutomation.mockReset().mockResolvedValue({ id: 'automation-1', title: 'Weekly revenue' });
		mocks.getChatProjectId.mockReset().mockResolvedValue('project-1');
		mocks.getForkMetadata.mockReset();
		mocks.getUserRoleInProject.mockReset().mockResolvedValue('user');
		mocks.isOnboardingChat.mockReset().mockResolvedValue(false);
	});

	async function authorize(body: Record<string, unknown>) {
		return authorizeAgentRun({
			userId: 'user-1',
			currentProject: { id: 'project-1' } as never,
			body: body as AgentRequest,
		});
	}

	it('gives a message sent with the automation form the automation editor', async () => {
		mocks.getForkMetadata.mockResolvedValue({
			type: 'automation_edit',
			id: 'automation-1',
			title: '',
			authorName: '',
		});

		const run = await authorize(requestWithDraft);

		expect(mocks.getAutomation).toHaveBeenCalledWith('project-1', 'user-1', 'automation-1');
		expect(run.profile).not.toBe(analyticsAgent);
		expect(run.profile.promptAppendix).toContain('editing one of their automations');
	});

	it('needs the automation creation feature to draft a new automation', async () => {
		mocks.getForkMetadata.mockResolvedValue({ type: 'automation_edit', id: '', title: '', authorName: '' });

		const run = await authorize(requestWithDraft);

		expect(mocks.assertUserGroupFeature).toHaveBeenCalledWith('project-1', 'user-1', 'automationCreation');
		expect(mocks.getAutomation).not.toHaveBeenCalled();
		expect(run.profile.promptAppendix).toContain('creating a new automation');
	});

	it('refuses an automation the user does not own', async () => {
		mocks.getForkMetadata.mockResolvedValue({
			type: 'automation_edit',
			id: 'automation-2',
			title: '',
			authorName: '',
		});
		mocks.getAutomation.mockResolvedValue(null);

		await expect(authorize(requestWithDraft)).rejects.toThrow('Automation not found: automation-2');
	});

	it('refuses an automation draft outside an automation editing chat', async () => {
		mocks.getForkMetadata.mockResolvedValue({ type: 'story_question', id: 'story-1', title: '', authorName: '' });

		await expect(authorize(requestWithDraft)).rejects.toThrow('editing chat');
	});

	it('keeps the analytics agent for messages without the automation form', async () => {
		const run = await authorize({ message: { text: 'Hello' }, mode: 'default' });

		expect(run.profile).toBe(analyticsAgent);
		expect(mocks.getForkMetadata).not.toHaveBeenCalled();
	});
});
