import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	assertProjectCloudBillingAccess: vi.fn(),
	getUser: vi.fn(),
	getUserRoleInProject: vi.fn(),
}));

vi.mock('../src/components/generate-chart', () => ({
	generateChartImage: vi.fn(),
}));

vi.mock('../src/queries/chat.queries', () => ({}));
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
	agentService: {},
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
});
