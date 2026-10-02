import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	addHook: vi.fn(),
	assertProjectCloudBillingAccess: vi.fn(),
	getChatProjectId: vi.fn(),
	getUserRoleInProject: vi.fn(),
	handleAgentRoute: vi.fn(),
	post: vi.fn(),
}));

vi.mock('../src/handlers/agent', () => ({
	handleAgentRoute: mocks.handleAgentRoute,
}));

vi.mock('../src/middleware/auth', () => ({
	authMiddleware: vi.fn(),
}));

vi.mock('../src/queries/chat.queries', () => ({
	getChatProjectId: mocks.getChatProjectId,
}));

vi.mock('../src/queries/project.queries', () => ({
	getUserRoleInProject: mocks.getUserRoleInProject,
}));

vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertProjectCloudBillingAccess: mocks.assertProjectCloudBillingAccess,
}));

vi.mock('../src/services/posthog', () => ({
	PostHogEvent: { MessageSent: 'message_sent' },
	posthog: { capture: vi.fn() },
}));

import { agentRoutes } from '../src/routes/agent';

describe('agent route cloud billing access', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		mocks.getChatProjectId.mockResolvedValue('chat-project-id');
		mocks.getUserRoleInProject.mockResolvedValue('user');
		await agentRoutes({ addHook: mocks.addHook, post: mocks.post } as never);
	});

	it('rejects a restricted chat before the agent handler can persist work', async () => {
		const accessError = new Error('Cloud billing access is restricted');
		mocks.assertProjectCloudBillingAccess.mockRejectedValue(accessError);

		await expect(
			handler()({
				user: { id: 'user-id' },
				project: { id: 'selected-project-id' },
				body: { chatId: 'chat-id' },
				headers: {},
			}),
		).rejects.toBe(accessError);

		expect(mocks.assertProjectCloudBillingAccess).toHaveBeenCalledWith('chat-project-id');
		expect(mocks.handleAgentRoute).not.toHaveBeenCalled();
	});
});

function handler() {
	return mocks.post.mock.calls[0][2] as (request: {
		user: { id: string };
		project: { id: string };
		body: { chatId: string };
		headers: Record<string, string>;
	}) => Promise<unknown>;
}
