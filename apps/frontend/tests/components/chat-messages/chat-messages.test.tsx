// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '../../helpers/query-client';

import { ChatMessagesContent } from '@/components/chat-messages/chat-messages';

const mocks = vi.hoisted(() => {
	const question = { id: 'user-message', role: 'user', parts: [{ type: 'text', text: 'How did revenue do?' }] };
	const streamingAnswer = {
		id: 'assistant-message',
		role: 'assistant',
		parts: [{ type: 'text', text: 'Revenue grew', state: 'streaming' }],
	};
	return { agent: { isRunning: false, isCatchingUp: false }, question, streamingAnswer, messages: [question] };
});

vi.mock('@/contexts/agent.provider', () => ({
	useAgentContext: () => mocks.agent,
	useAgentMessages: () => mocks.messages,
}));
vi.mock('@/main', () => ({
	trpc: { chat: { getForkMetadata: { queryOptions: () => ({ queryKey: ['fork'], queryFn: async () => null }) } } },
}));
vi.mock('@/queries/use-chat-query', () => ({ useChatQuery: () => ({ data: false }) }));
vi.mock('@/hooks/use-chat-id', () => ({ useChatId: () => 'chat-1' }));
vi.mock('@/hooks/use-tool-call-density', () => ({ useToolCallDensity: () => ['compact'] }));
vi.mock('@/hooks/use-scroll-to-bottom-on-new-user-message', () => ({ useScrollToBottomOnNewUserMessage: () => {} }));
vi.mock('@/components/chat-messages/user-message', () => ({ UserMessage: () => <p>Question</p> }));
vi.mock('@/components/chat-messages/chat-error', () => ({ ChatError: () => null }));
vi.mock('@/components/chat-messages/assistant-message-actions', () => ({ AssistantMessageActions: () => null }));
vi.mock('@/components/chat-messages/citation-text', () => ({
	AssistantTextWithCitation: ({ text }: { text: string }) => <p>{text}</p>,
}));
vi.mock('@/components/ui/conversation', () => ({ ConversationEmptyState: () => null }));

afterEach(() => {
	cleanup();
	mocks.agent = { isRunning: false, isCatchingUp: false };
	mocks.messages = [mocks.question];
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

	it('keeps the thinking loader under an answer that is still streaming', async () => {
		mocks.agent = { isRunning: true, isCatchingUp: false };
		mocks.messages = [mocks.question, mocks.streamingAnswer];

		renderMessages();

		await screen.findByText('Revenue grew');
		expect(screen.getByText(/^(Crunching|Analyzing|Thinking)$/)).toBeTruthy();
	});

	it('removes the thinking loader once the answer is complete', async () => {
		mocks.messages = [mocks.question, mocks.streamingAnswer];

		renderMessages();

		await screen.findByText('Revenue grew');
		expect(screen.queryByText(/^(Crunching|Analyzing|Thinking)$/)).toBeNull();
	});
});

function renderMessages() {
	return render(
		<QueryClientProvider client={createTestQueryClient()}>
			<ChatMessagesContent />
		</QueryClientProvider>,
	);
}
