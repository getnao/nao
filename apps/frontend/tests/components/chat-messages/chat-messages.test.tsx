// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '../../helpers/query-client';

import { ChatMessagesContent } from '@/components/chat-messages/chat-messages';

const mocks = vi.hoisted(() => ({
	agent: { isRunning: false, isCatchingUp: false },
	messages: [{ id: 'user-message', role: 'user', parts: [{ type: 'text', text: 'How did revenue do?' }] }],
}));

vi.mock('@/contexts/agent.provider', () => ({
	useAgentContext: () => mocks.agent,
	useAgentMessages: () => mocks.messages,
}));
vi.mock('@/main', () => ({
	trpc: { chat: { getForkMetadata: { queryOptions: () => ({ queryKey: ['fork'], queryFn: async () => null }) } } },
}));
vi.mock('@/queries/use-chat-query', () => ({ useChatQuery: () => ({ data: false }) }));
vi.mock('@/hooks/use-chat-id', () => ({ useChatId: () => 'chat-1' }));
vi.mock('@/hooks/use-scroll-to-bottom-on-new-user-message', () => ({ useScrollToBottomOnNewUserMessage: () => {} }));
vi.mock('@/components/chat-messages/user-message', () => ({ UserMessage: () => <p>Question</p> }));
vi.mock('@/components/chat-messages/chat-error', () => ({ ChatError: () => null }));
vi.mock('@/components/ui/conversation', () => ({ ConversationEmptyState: () => null }));

afterEach(() => {
	cleanup();
	mocks.agent = { isRunning: false, isCatchingUp: false };
});

describe('ChatMessagesContent', () => {
	it('shows a discreet loader while the chat catches up on a running answer', async () => {
		mocks.agent = { isRunning: false, isCatchingUp: true };

		renderMessages();

		expect(await screen.findByText('Catching up on the answer…')).toBeTruthy();
	});

	it('shows no catch-up loader once the chat caught up', async () => {
		renderMessages();

		await screen.findByText('Question');
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(screen.queryByText('Catching up on the answer…')).toBeNull();
	});
});

function renderMessages() {
	return render(
		<QueryClientProvider client={createTestQueryClient()}>
			<ChatMessagesContent />
		</QueryClientProvider>,
	);
}
