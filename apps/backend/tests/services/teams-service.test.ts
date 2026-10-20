import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TeamsConfig } from '../../src/queries/project-teams-config.queries';
import { teamsService } from '../../src/services/teams';

type MessageHandler = (
	thread: { isDM: boolean; post: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> },
	message: { raw: unknown; text: string },
) => Promise<void>;

const teamsHarness = vi.hoisted(() => ({
	assertProjectCloudBillingAccess: vi.fn(),
	createChat: vi.fn(),
	createAgent: vi.fn(),
	credentials: [] as Array<[string, string, string]>,
	getChat: vi.fn(),
	getChatByTeamsThread: vi.fn(),
	messageHandlers: [] as MessageHandler[],
	projectRole: vi.fn(),
	upsertMessage: vi.fn(),
}));

vi.mock('@azure/identity', () => ({
	ClientSecretCredential: class {
		constructor(tenantId: string, appId: string, appPassword: string) {
			teamsHarness.credentials.push([tenantId, appId, appPassword]);
		}
	},
}));

vi.mock('@chat-adapter/state-memory', () => ({
	createMemoryState: vi.fn(() => ({})),
}));

vi.mock('@chat-adapter/teams', () => ({
	createTeamsAdapter: vi.fn(() => ({})),
}));

vi.mock('@microsoft/microsoft-graph-client', () => ({
	Client: {
		initWithMiddleware: vi.fn(() => ({
			api: vi.fn(() => ({
				select: vi.fn(() => ({
					get: vi.fn(async () => ({ mail: 'user@example.com' })),
				})),
			})),
		})),
	},
}));

vi.mock('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials', () => ({
	TokenCredentialAuthenticationProvider: class {},
}));

vi.mock('chat', () => ({
	Card: vi.fn(),
	Chat: class {
		webhooks = { teams: vi.fn() };

		onAction(): void {}

		onNewMessage(_pattern: RegExp, handler: MessageHandler): void {
			teamsHarness.messageHandlers.push(handler);
		}

		onSubscribedMessage(): void {}
	},
}));

vi.mock('../../src/components/generate-chart', () => ({
	generateChartImage: vi.fn(),
}));

vi.mock('../../src/queries/chart-image', () => ({}));
vi.mock('../../src/queries/chat.queries', () => ({
	createChat: teamsHarness.createChat,
	getChat: teamsHarness.getChat,
	getChatByTeamsThread: teamsHarness.getChatByTeamsThread,
	upsertMessage: teamsHarness.upsertMessage,
}));
vi.mock('../../src/queries/feedback.queries', () => ({}));
vi.mock('../../src/queries/project.queries', () => ({
	getUserRoleInProject: teamsHarness.projectRole,
}));
vi.mock('../../src/queries/user.queries', () => ({
	getUser: vi.fn(async () => ({ id: 'user-id' })),
}));
vi.mock('../../src/services/agent', () => ({
	agentService: { create: teamsHarness.createAgent, get: vi.fn() },
}));
vi.mock('../../src/services/cloud-billing-access.service', () => ({
	assertProjectCloudBillingAccess: teamsHarness.assertProjectCloudBillingAccess,
}));
vi.mock('../../src/services/posthog', () => ({
	PostHogEvent: { MessageSent: 'message_sent' },
	posthog: { capture: vi.fn() },
}));
vi.mock('../../src/utils/logger', () => ({
	logger: { error: vi.fn() },
}));
vi.mock('../../src/utils/messaging-provider', () => ({
	createTextBlock: vi.fn((text: string) => ({ text })),
	formatMessagingError: vi.fn(() => 'billing blocked'),
}));

const INCOMING_MESSAGE = {
	text: 'question',
	raw: { from: { aadObjectId: 'aad-id' }, conversation: { tenantId: 'sender-tenant' } },
};

describe('TeamsService', () => {
	beforeEach(() => {
		Object.assign(teamsService as unknown as Record<string, unknown>, {
			_bot: null,
			_projectId: '',
			_appId: '',
			_appPassword: '',
			_tenantId: '',
			_redirectUrl: '',
			_modelSelection: undefined,
		});
		teamsHarness.assertProjectCloudBillingAccess.mockReset().mockResolvedValue(undefined);
		teamsHarness.createChat.mockReset();
		teamsHarness.createAgent.mockReset().mockRejectedValue(new Error('stop after agent creation'));
		teamsHarness.credentials.length = 0;
		teamsHarness.getChat.mockReset().mockResolvedValue([{ id: 'chat-id', messages: [] }]);
		teamsHarness.getChatByTeamsThread.mockReset().mockResolvedValue({ id: 'chat-id' });
		teamsHarness.messageHandlers.length = 0;
		teamsHarness.projectRole.mockReset().mockResolvedValue('user');
		teamsHarness.upsertMessage.mockReset();
	});

	it('keeps each webhook handler bound to its project configuration', async () => {
		teamsService.getWebhooks(createTeamsConfig('a'));
		const firstProjectHandler = teamsHarness.messageHandlers[0];
		teamsService.getWebhooks(createTeamsConfig('b'));
		const secondProjectHandler = teamsHarness.messageHandlers[1];

		const thread = createThread();
		await firstProjectHandler(thread, INCOMING_MESSAGE);
		await secondProjectHandler(thread, INCOMING_MESSAGE);

		expect(teamsHarness.credentials).toEqual([
			['sender-tenant', 'app-a', 'password-a'],
			['sender-tenant', 'app-b', 'password-b'],
		]);
		expect(teamsHarness.projectRole).toHaveBeenNthCalledWith(1, 'project-a', 'user-id');
		expect(teamsHarness.projectRole).toHaveBeenNthCalledWith(2, 'project-b', 'user-id');
	});

	it('passes preverified billing access to agent creation', async () => {
		teamsService.getWebhooks(createTeamsConfig('a'));
		await teamsHarness.messageHandlers[0](createThread(), INCOMING_MESSAGE);

		expect(teamsHarness.createAgent).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'chat-id', projectId: 'project-a' }),
			undefined,
			{ billingAccessVerifiedProjectId: 'project-a', supportsCustomCharts: false },
		);
	});

	it('checks billing access before storing a new thread message', async () => {
		teamsHarness.assertProjectCloudBillingAccess.mockRejectedValue(new Error('billing restricted'));
		teamsHarness.getChatByTeamsThread.mockResolvedValue(null);

		teamsService.getWebhooks(createTeamsConfig('a'));
		await teamsHarness.messageHandlers[0](createThread(), INCOMING_MESSAGE);

		expect(teamsHarness.assertProjectCloudBillingAccess).toHaveBeenCalledWith('project-a');
		expect(teamsHarness.getChatByTeamsThread).not.toHaveBeenCalled();
		expect(teamsHarness.createChat).not.toHaveBeenCalled();
		expect(teamsHarness.upsertMessage).not.toHaveBeenCalled();
		expect(teamsHarness.createAgent).not.toHaveBeenCalled();
	});
});

function createTeamsConfig(suffix: string): TeamsConfig {
	return {
		projectId: `project-${suffix}`,
		appId: `app-${suffix}`,
		appPassword: `password-${suffix}`,
		tenantId: `tenant-${suffix}`,
		redirectUrl: `https://${suffix}.example`,
	};
}

function createThread() {
	return {
		id: 'thread-id',
		isDM: true,
		post: vi.fn(async () => ({ edit: vi.fn(), delete: vi.fn() })),
		subscribe: vi.fn(async () => undefined),
	};
}
