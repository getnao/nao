import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ChatQueriesModule from '../../src/queries/chat.queries';

const mocks = vi.hoisted(() => ({
	assertProjectCloudBillingAccess: vi.fn(),
	getChatProjectId: vi.fn(),
	getForkMetadata: vi.fn(),
	getUser: vi.fn(),
	getUserRoleInProject: vi.fn(),
	isOnboardingChat: vi.fn(),
}));

vi.mock('../../src/queries/project.queries', () => ({ getUserRoleInProject: mocks.getUserRoleInProject }));
vi.mock('../../src/queries/user.queries', () => ({ getUser: mocks.getUser }));
vi.mock('../../src/services/cloud-billing-access.service', () => ({
	assertProjectCloudBillingAccess: mocks.assertProjectCloudBillingAccess,
}));
vi.mock('../../src/queries/chat.queries', async (importOriginal) => ({
	...(await importOriginal<typeof ChatQueriesModule>()),
	getChatProjectId: mocks.getChatProjectId,
	getForkMetadata: mocks.getForkMetadata,
	isOnboardingChat: mocks.isOnboardingChat,
}));

import { authorizeAgentRun } from '../../src/services/agent-run';
import type { AgentRequest } from '../../src/types/chat';

const CONTEXT_EDIT_CHAT = { type: 'context_edit', id: 'project-1', title: 'Context Hub', authorName: '' };

describe('Context Hub chat runs', () => {
	beforeEach(() => {
		mocks.assertProjectCloudBillingAccess.mockReset().mockResolvedValue(undefined);
		mocks.getChatProjectId.mockReset().mockResolvedValue('project-1');
		mocks.getForkMetadata.mockReset().mockResolvedValue(CONTEXT_EDIT_CHAT);
		mocks.getUser.mockReset().mockResolvedValue({ id: 'user-1', name: 'Ada', email: 'ada@example.com' });
		mocks.getUserRoleInProject.mockReset().mockResolvedValue('context_admin');
		mocks.isOnboardingChat.mockReset().mockResolvedValue(false);
	});

	async function authorize(body: Record<string, unknown>) {
		return authorizeAgentRun({
			userId: 'user-1',
			currentProject: { id: 'project-1' } as never,
			body: {
				message: { text: 'Describe this table' },
				mode: 'default',
				chatId: 'chat-1',
				...body,
			} as AgentRequest,
		});
	}

	it.each(['admin', 'context_admin'])('gives a %s the context editor with the open file', async (role) => {
		mocks.getUserRoleInProject.mockResolvedValue(role);

		const run = await authorize({ contextHub: { openPath: '/docs/glossary.md' } });

		expect(run.profile.promptAppendix).toContain('Context Hub Editor');
		expect(run.profile.promptAppendix).toContain('/docs/glossary.md');
	});

	it('refuses a user who cannot edit the context', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('user');

		await expect(authorize({ contextHub: { openPath: null } })).rejects.toThrow('admins and context admins');
	});

	it('refuses the context editor outside a Context Hub chat', async () => {
		mocks.getForkMetadata.mockResolvedValue({ ...CONTEXT_EDIT_CHAT, type: 'automation_edit' });

		await expect(authorize({ contextHub: { openPath: null } })).rejects.toThrow('Context Hub chat');
	});

	it('keeps other chats away from the context editor', async () => {
		const run = await authorize({});

		expect(run.profile.promptAppendix).toBeUndefined();
		expect(mocks.getForkMetadata).not.toHaveBeenCalled();
	});
});
