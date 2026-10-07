import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	assertProjectCloudBillingAccess: vi.fn(),
	createAgent: vi.fn(),
	getChat: vi.fn(),
	getChatByTelegramThread: vi.fn(),
	getUser: vi.fn(),
	getUserRoleInProject: vi.fn(),
	upsertMessage: vi.fn(),
}));

vi.mock('../src/components/generate-chart', () => ({
	generateChartImage: vi.fn(),
}));

vi.mock('../src/queries/chat.queries', () => ({
	getChat: mocks.getChat,
	getChatByTelegramThread: mocks.getChatByTelegramThread,
	upsertMessage: mocks.upsertMessage,
}));
vi.mock('../src/queries/feedback.queries', () => ({}));
vi.mock('../src/queries/project.queries', () => ({
	getUserRoleInProject: mocks.getUserRoleInProject,
}));
vi.mock('../src/queries/user.queries', () => ({
	getUser: mocks.getUser,
	getUserByMessagingProviderCode: vi.fn(),
}));

vi.mock('../src/utils/messaging-provider', () => ({
	createLiveToolCall: vi.fn(),
	createPlainTextBlock: vi.fn(),
	createSummaryToolCalls: vi.fn(),
	createTelegramCompletionCard: vi.fn(),
	createTelegramMapLinkCard: vi.fn(),
	createTelegramStopButtonCard: vi.fn(),
	EXCLUDED_TOOLS: [],
	formatClarificationText: vi.fn(),
	formatMessagingError: vi.fn(() => 'generic error'),
	renderMapImage: vi.fn(),
}));

vi.mock('../src/services/agent', () => ({
	agentService: { create: mocks.createAgent },
}));

vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertProjectCloudBillingAccess: mocks.assertProjectCloudBillingAccess,
}));

vi.mock('../src/services/posthog', () => ({
	posthog: { capture: vi.fn() },
	PostHogEvent: { MessageSent: 'message_sent' },
}));

import { telegramService } from '../src/services/telegram';

describe('Telegram user validation', () => {
	beforeEach(() => {
		(
			telegramService as unknown as {
				_projectId: string;
				_redirectUrl: string;
				_userByTelegramId: Map<string, string>;
			}
		)._projectId = 'project-id';
		(
			telegramService as unknown as {
				_redirectUrl: string;
				_userByTelegramId: Map<string, string>;
			}
		)._redirectUrl = 'https://nao.example/';
		(
			telegramService as unknown as {
				_userByTelegramId: Map<string, string>;
			}
		)._userByTelegramId.clear();
		mocks.assertProjectCloudBillingAccess.mockReset();
		mocks.createAgent.mockReset().mockResolvedValue({
			getModelId: vi.fn(() => 'model-id'),
			stream: vi.fn(
				() =>
					new ReadableStream({
						start(controller) {
							controller.close();
						},
					}),
			),
		});
		mocks.getChat.mockReset().mockResolvedValue([{ id: 'chat-id', messages: [] }]);
		mocks.getChatByTelegramThread.mockReset().mockResolvedValue({ id: 'chat-id' });
		mocks.getUser.mockReset();
		mocks.getUserRoleInProject.mockReset();
		mocks.upsertMessage.mockReset();
	});

	it('responds once when the Telegram user is not linked', async () => {
		const post = vi.fn().mockResolvedValue(undefined);

		await (
			telegramService as unknown as {
				_handleWorkFlow: (
					thread: { post: typeof post },
					message: { text: string; raw: { from: { id: number } } },
				) => Promise<void>;
			}
		)._handleWorkFlow({ post }, { text: 'Hello', raw: { from: { id: 123 } } });

		expect(post).toHaveBeenCalledOnce();
		expect(post).toHaveBeenCalledWith(
			'👋 Welcome! Send `/login <your-code>` to link your account. Find your code in project settings.',
		);
	});

	it('responds once when the Telegram user lacks project access', async () => {
		const post = vi.fn().mockResolvedValue(undefined);
		const service = telegramService as unknown as {
			_handleWorkFlow: (
				thread: { post: typeof post },
				message: { text: string; raw: { from: { id: number } } },
			) => Promise<void>;
			_userByTelegramId: Map<string, string>;
		};
		service._userByTelegramId.set('456', 'user@example.com');
		mocks.getUser.mockResolvedValue({ id: 'user-id' });
		mocks.getUserRoleInProject.mockResolvedValue('viewer');

		await service._handleWorkFlow({ post }, { text: 'Hello', raw: { from: { id: 456 } } });

		expect(post).toHaveBeenCalledOnce();
		expect(post).toHaveBeenCalledWith(
			"❌ You don't have permission to use nao in this project. Please contact an administrator.",
		);
		expect(mocks.assertProjectCloudBillingAccess).not.toHaveBeenCalled();
	});

	it('responds once when cloud billing access is restricted', async () => {
		const post = vi.fn().mockResolvedValue(undefined);
		const service = telegramService as unknown as {
			_handleWorkFlow: (
				thread: { post: typeof post },
				message: { text: string; raw: { from: { id: number } } },
			) => Promise<void>;
			_userByTelegramId: Map<string, string>;
		};
		service._userByTelegramId.set('789', 'user@example.com');
		mocks.getUser.mockResolvedValue({ id: 'user-id' });
		mocks.getUserRoleInProject.mockResolvedValue('user');
		mocks.assertProjectCloudBillingAccess.mockRejectedValue(new Error('Cloud billing access is restricted'));

		await service._handleWorkFlow({ post }, { text: 'Hello', raw: { from: { id: 789 } } });

		expect(mocks.assertProjectCloudBillingAccess).toHaveBeenCalledOnce();
		expect(post).toHaveBeenCalledOnce();
		expect(post).toHaveBeenCalledWith('generic error');
		expect(post).not.toHaveBeenCalledWith('✨ nao is answering...');
	});

	it('starts answering when the entitled user passes the billing gate', async () => {
		const sentMessage = { delete: vi.fn(), edit: vi.fn() };
		const post = vi.fn().mockResolvedValue(sentMessage);
		const service = telegramService as unknown as {
			_handleWorkFlow: (
				thread: { id: string; post: typeof post },
				message: { text: string; raw: { from: { id: number } } },
			) => Promise<void>;
			_userByTelegramId: Map<string, string>;
		};
		service._userByTelegramId.set('101', 'user@example.com');
		mocks.getUser.mockResolvedValue({ id: 'user-id' });
		mocks.getUserRoleInProject.mockResolvedValue('user');

		await service._handleWorkFlow({ id: 'thread-id', post }, { text: 'Hello', raw: { from: { id: 101 } } });

		expect(mocks.assertProjectCloudBillingAccess).toHaveBeenCalledWith('project-id');
		expect(post).toHaveBeenNthCalledWith(1, '✨ nao is answering...');
		expect(mocks.upsertMessage).toHaveBeenCalledWith({
			role: 'user',
			parts: [{ type: 'text', text: 'Hello' }],
			chatId: 'chat-id',
			senderUserId: 'user-id',
			source: 'telegram',
		});
		expect(mocks.getChat).toHaveBeenCalledWith('chat-id');
		expect(mocks.createAgent).toHaveBeenCalledOnce();
	});
});
