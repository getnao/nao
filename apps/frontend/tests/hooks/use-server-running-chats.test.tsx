// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '../helpers/query-client';
import type { Agent } from '@/services/agents';

import { useServerRunningChats } from '@/hooks/use-server-running-chats';
import { agentService } from '@/services/agents';
import { chatActivityStore } from '@/stores/chat-activity';

const mocks = vi.hoisted(() => ({
	openChatId: undefined as string | undefined,
	runningChatIds: [] as string[],
}));

vi.mock('@/main', () => ({
	trpc: {
		chat: {
			listRunning: {
				queryOptions: () => ({ queryKey: ['chat.listRunning'], queryFn: async () => mocks.runningChatIds }),
			},
		},
	},
}));
vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ chatId: mocks.openChatId }) }));

const CHAT_IDS = ['chat-elsewhere', 'chat-open', 'chat-with-agent'];

afterEach(() => {
	cleanup();
	mocks.openChatId = undefined;
	mocks.runningChatIds = [];
	agentService.disposeAgent('chat-with-agent');
	CHAT_IDS.forEach((chatId) => {
		chatActivityStore.setRunning(chatId, false);
		chatActivityStore.setUnread(chatId, false);
	});
});

describe('useServerRunningChats', () => {
	it('shows the chats the server runs as running, and the ones that finished out of sight as unread', async () => {
		mocks.openChatId = 'chat-open';
		mocks.runningChatIds = ['chat-elsewhere', 'chat-open'];
		const queryClient = createTestQueryClient();
		renderHook(() => useServerRunningChats(true), { wrapper: withQueryClient(queryClient) });

		await waitFor(() => expect(chatActivityStore.getActivity('chat-elsewhere').running).toBe(true));
		expect(chatActivityStore.getActivity('chat-open').running).toBe(true);

		mocks.runningChatIds = [];
		await queryClient.refetchQueries({ queryKey: ['chat.listRunning'] });

		await waitFor(() =>
			expect(chatActivityStore.getActivity('chat-elsewhere')).toEqual({ running: false, unread: true }),
		);
		expect(chatActivityStore.getActivity('chat-open')).toEqual({ running: false, unread: false });
	});

	it('leaves a chat with an agent in this tab to that agent', async () => {
		agentService.registerAgent('chat-with-agent', {} as Agent);
		mocks.runningChatIds = ['chat-with-agent', 'chat-elsewhere'];
		renderHook(() => useServerRunningChats(true), { wrapper: withQueryClient(createTestQueryClient()) });

		await waitFor(() => expect(chatActivityStore.getActivity('chat-elsewhere').running).toBe(true));
		expect(chatActivityStore.getActivity('chat-with-agent').running).toBe(false);
	});
});

function withQueryClient(queryClient: ReturnType<typeof createTestQueryClient>) {
	return ({ children }: { children: React.ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
