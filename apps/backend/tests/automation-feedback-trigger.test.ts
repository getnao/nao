import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	assertProjectCloudBillingAccess: vi.fn(),
	canUserAccessStory: vi.fn(),
	getRatedMessageContext: vi.fn(),
	listEventTriggeredAutomations: vi.fn(),
	startAutomationRun: vi.fn(),
	roles: {} as Record<string, 'admin' | 'context_admin' | 'user' | 'viewer' | null>,
}));

vi.mock('../src/env', () => ({ env: { BETA_AUTOMATIONS_ENABLED: true, BETTER_AUTH_URL: 'https://nao.test/' } }));
vi.mock('../src/handlers/automation.handler', () => ({ startAutomationRun: mocks.startAutomationRun }));
vi.mock('../src/queries/automation.queries', () => ({
	listEventTriggeredAutomations: mocks.listEventTriggeredAutomations,
}));
vi.mock('../src/queries/feedback.queries', () => ({ getRatedMessageContext: mocks.getRatedMessageContext }));
vi.mock('../src/queries/project.queries', () => ({
	getUserRoleInProject: vi.fn(async (_projectId: string, userId: string) => mocks.roles[userId] ?? null),
}));
vi.mock('../src/queries/story.queries', () => ({ canUserAccessStory: mocks.canUserAccessStory }));
vi.mock('../src/queries/user.queries', () => ({
	getUser: vi.fn(async ({ id }: { id: string }) => ({ id, name: 'Submitter', email: 'submitter@example.com' })),
}));
vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertProjectCloudBillingAccess: mocks.assertProjectCloudBillingAccess,
}));

import {
	triggerChatFeedbackAutomations,
	triggerStoryFeedbackAutomations,
} from '../src/services/automation-feedback-trigger.service';

function buildAutomation(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		userId: 'admin-id',
		scheduledJob: null,
		enabled: false,
		eventTriggers: { feedback: { enabled: true, votes: ['down'], sources: ['chat', 'story'] } },
		...overrides,
	};
}

describe('feedback automation trigger', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.roles = { 'admin-id': 'admin', 'user-id': 'user', 'viewer-id': 'viewer' };
		mocks.startAutomationRun.mockResolvedValue({ id: 'run-id' });
		mocks.canUserAccessStory.mockResolvedValue(true);
		mocks.getRatedMessageContext.mockResolvedValue({
			chatId: 'chat-id',
			chatTitle: 'Revenue',
			projectId: 'project-id',
			chatOwnerId: 'submitter-id',
			question: 'What was revenue?',
			answer: 'Revenue was 42.',
		});
	});

	it('starts matching automations with the chat feedback event', async () => {
		mocks.listEventTriggeredAutomations.mockResolvedValue([buildAutomation('match')]);

		await triggerChatFeedbackAutomations({
			messageId: 'message-id',
			submitterId: 'submitter-id',
			vote: 'down',
			explanation: '  wrong  ',
		});

		expect(mocks.listEventTriggeredAutomations).toHaveBeenCalledWith('project-id', 'feedback');
		expect(mocks.startAutomationRun).toHaveBeenCalledWith('match', {
			billingAccessVerifiedProjectId: 'project-id',
			requireEnabled: false,
			trigger: 'feedback',
			triggerEvent: {
				kind: 'feedback',
				source: 'chat',
				vote: 'down',
				explanation: 'wrong',
				submitter: { name: 'Submitter', email: 'submitter@example.com' },
				url: 'https://nao.test/settings/usage/replay/chat-id',
				chatTitle: 'Revenue',
				question: 'What was revenue?',
				answer: 'Revenue was 42.',
			},
		});
	});

	it('skips automations whose trigger does not match, is disabled, or whose schedule is paused', async () => {
		mocks.listEventTriggeredAutomations.mockResolvedValue([
			buildAutomation('wrong-vote', {
				eventTriggers: { feedback: { enabled: true, votes: ['up'], sources: ['chat'] } },
			}),
			buildAutomation('wrong-source', {
				eventTriggers: { feedback: { enabled: true, votes: ['down'], sources: ['story'] } },
			}),
			buildAutomation('disabled', {
				eventTriggers: { feedback: { enabled: false, votes: ['down'], sources: ['chat'] } },
			}),
			buildAutomation('paused', { scheduledJob: { id: 'job-id' }, enabled: false }),
			buildAutomation('scheduled', { scheduledJob: { id: 'job-id' }, enabled: true }),
		]);

		await triggerChatFeedbackAutomations({ messageId: 'message-id', vote: 'down' });

		expect(mocks.startAutomationRun).toHaveBeenCalledTimes(1);
		expect(mocks.startAutomationRun).toHaveBeenCalledWith('scheduled', expect.anything());
	});

	it('only sends chat feedback to automations owned by admins or context admins', async () => {
		mocks.listEventTriggeredAutomations.mockResolvedValue([
			buildAutomation('admin-owned'),
			buildAutomation('user-owned', { userId: 'user-id' }),
		]);

		await triggerChatFeedbackAutomations({ messageId: 'message-id', vote: 'down' });

		expect(mocks.startAutomationRun).toHaveBeenCalledTimes(1);
		expect(mocks.startAutomationRun).toHaveBeenCalledWith('admin-owned', expect.anything());
	});

	it('sends story feedback to owners who can access the story', async () => {
		mocks.listEventTriggeredAutomations.mockResolvedValue([
			buildAutomation('user-owned', { userId: 'user-id' }),
			buildAutomation('viewer-owned', { userId: 'viewer-id' }),
			buildAutomation('no-access', { userId: 'admin-id' }),
		]);
		mocks.canUserAccessStory.mockImplementation(async (_storyId: string, userId: string) => userId !== 'admin-id');

		await triggerStoryFeedbackAutomations({
			projectId: 'project-id',
			story: { id: 'story-id', title: 'Weekly KPIs' },
			submitterId: 'submitter-id',
			vote: 'down',
			explanation: null,
		});

		expect(mocks.startAutomationRun).toHaveBeenCalledTimes(1);
		expect(mocks.startAutomationRun).toHaveBeenCalledWith(
			'user-owned',
			expect.objectContaining({
				triggerEvent: expect.objectContaining({
					source: 'story',
					storyTitle: 'Weekly KPIs',
					url: 'https://nao.test/stories/story-id',
				}),
			}),
		);
	});

	it('leaves the submitter out when the caller did not identify the voter', async () => {
		mocks.listEventTriggeredAutomations.mockResolvedValue([buildAutomation('match')]);

		await triggerChatFeedbackAutomations({ messageId: 'message-id', vote: 'up' });

		expect(mocks.startAutomationRun).not.toHaveBeenCalled();

		mocks.listEventTriggeredAutomations.mockResolvedValue([
			buildAutomation('match', {
				eventTriggers: { feedback: { enabled: true, votes: ['up'], sources: ['chat'] } },
			}),
		]);
		await triggerChatFeedbackAutomations({ messageId: 'message-id', vote: 'up' });

		expect(mocks.startAutomationRun).toHaveBeenCalledWith(
			'match',
			expect.objectContaining({ triggerEvent: expect.objectContaining({ submitter: null }) }),
		);
	});

	it('does not check billing nor start runs when nothing matches', async () => {
		mocks.listEventTriggeredAutomations.mockResolvedValue([
			buildAutomation('up-only', {
				eventTriggers: { feedback: { enabled: true, votes: ['up'], sources: ['chat'] } },
			}),
		]);

		await triggerChatFeedbackAutomations({ messageId: 'message-id', vote: 'down' });

		expect(mocks.assertProjectCloudBillingAccess).not.toHaveBeenCalled();
		expect(mocks.startAutomationRun).not.toHaveBeenCalled();
	});
});
