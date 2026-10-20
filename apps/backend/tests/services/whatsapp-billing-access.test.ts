import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	assertProjectCloudBillingAccess: vi.fn(),
	createAgent: vi.fn(),
	getLinkedWhatsappUser: vi.fn(),
	getUser: vi.fn(),
	getUserRoleInProject: vi.fn(),
	transcribeAudio: vi.fn(),
}));

vi.mock('../../src/queries/project-whatsapp-link.queries', () => ({
	getLinkedWhatsappUser: mocks.getLinkedWhatsappUser,
}));
vi.mock('../../src/queries/project.queries', () => ({
	getUserRoleInProject: mocks.getUserRoleInProject,
}));
vi.mock('../../src/queries/user.queries', () => ({
	getUser: mocks.getUser,
	getUserByMessagingProviderCode: vi.fn(),
}));
vi.mock('../../src/services/agent', () => ({
	agentService: { create: mocks.createAgent },
}));
vi.mock('../../src/services/cloud-billing-access.service', () => ({
	assertProjectCloudBillingAccess: mocks.assertProjectCloudBillingAccess,
}));
vi.mock('../../src/services/transcribe.service', () => ({
	transcribeAudio: mocks.transcribeAudio,
}));
vi.mock('../../src/utils/messaging-provider', () => ({
	EXCLUDED_TOOLS: [],
	formatMessagingError: vi.fn(() => 'billing blocked'),
}));

import { whatsappService } from '../../src/services/whatsapp';

type WhatsappServiceInternals = {
	_projectId: string;
	_currentAccessToken: string;
	_currentPhoneNumberId: string;
	_handleWorkFlow: (
		thread: { post: ReturnType<typeof vi.fn> },
		message: { id: string; text: string; author: { userId: string }; attachments: unknown[] },
	) => Promise<void>;
	_createAgentStream: (
		chat: { id: string; messages: unknown[] },
		ctx: { user: { id: string }; timezone: string },
		chatUrl: string,
	) => Promise<ReadableStream>;
};

const service = whatsappService as unknown as WhatsappServiceInternals;

describe('WhatsApp billing access', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true })),
		);
		service._projectId = 'project-1';
		service._currentAccessToken = 'token';
		service._currentPhoneNumberId = 'phone-1';
		mocks.getLinkedWhatsappUser.mockResolvedValue({ userId: 'user-1' });
		mocks.getUser.mockResolvedValue({ id: 'user-1' });
		mocks.getUserRoleInProject.mockResolvedValue('user');
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('checks access before processing a voice note', async () => {
		mocks.assertProjectCloudBillingAccess.mockRejectedValue(new Error('Cloud billing access is restricted'));
		const post = vi.fn().mockResolvedValue(undefined);

		await service._handleWorkFlow(
			{ post },
			{
				id: 'message-1',
				text: '[Voice message]',
				author: { userId: 'whatsapp-user-1' },
				attachments: [{ type: 'audio', contentType: 'audio/ogg' }],
			},
		);

		expect(mocks.assertProjectCloudBillingAccess).toHaveBeenCalledWith('project-1');
		expect(mocks.transcribeAudio).not.toHaveBeenCalled();
		expect(mocks.createAgent).not.toHaveBeenCalled();
		expect(post).toHaveBeenCalledWith('billing blocked');
	});

	it('does not reuse the earlier billing check when creating the agent', async () => {
		const stream = new ReadableStream();
		mocks.createAgent.mockResolvedValue({
			getModelId: () => 'model-1',
			stream: () => stream,
		});

		await service._createAgentStream(
			{ id: 'chat-1', messages: [] },
			{ user: { id: 'user-1' }, timezone: 'UTC' },
			'https://example.com/chat-1',
		);

		expect(mocks.createAgent).toHaveBeenCalledWith(
			{ id: 'chat-1', messages: [], projectId: 'project-1', userId: 'user-1' },
			undefined,
			{ supportsCustomCharts: false },
		);
	});
});
