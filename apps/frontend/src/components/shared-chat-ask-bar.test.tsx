// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharedChatAskBar } from './shared-chat-ask-bar';

import { requestAsk } from '@/stores/ask-bar';

const mocks = vi.hoisted(() => ({
	askSharedChat: vi.fn(),
	queueOrSendMessage: vi.fn(async () => {}),
}));

vi.mock('@tanstack/react-query', () => ({
	useMutation: () => ({ mutateAsync: mocks.askSharedChat, isPending: false, isError: false }),
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn(), useParams: () => undefined }));
vi.mock('@/main', () => ({
	trpc: {
		chatFork: {
			askSharedChat: { mutationOptions: () => ({}) },
			listSharedChatQuickQuestions: { queryKey: () => [] },
		},
	},
}));
vi.mock('@/contexts/agent.provider', () => ({
	AgentProvider: ({ children }: { children: React.ReactNode }) => children,
	useAgentContext: () => ({ queueOrSendMessage: mocks.queueOrSendMessage, isRunning: false }),
	useAgentMessages: () => [],
}));
vi.mock('@/contexts/set-chat-input-callback', () => ({
	SetChatInputCallbackProvider: ({ children }: { children: React.ReactNode }) => children,
	useRegisterSetChatInputCallback: vi.fn(),
}));
vi.mock('@/components/chat-messages/chat-messages', () => ({ ChatMessagesContent: () => null }));
vi.mock('@/components/ui/conversation', () => ({
	Conversation: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	ConversationContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	ConversationScrollButton: () => null,
}));
vi.mock('@/components/chat-input-animated-border', () => ({ ChatInputAnimatedBorder: () => null }));

describe('SharedChatAskBar', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.askSharedChat.mockResolvedValue({ chatId: 'question-chat' });
	});

	afterEach(cleanup);

	it('asks about the selected text of the shared chat', () => {
		render(<SharedChatAskBar shareId='share-1' />);
		act(() => requestAsk({ chatId: null, selection: { text: 'Revenue dipped', start: 4, end: 18 } }));

		ask('Why?');

		expect(mocks.askSharedChat).toHaveBeenCalledWith({
			shareId: 'share-1',
			selection: { start: 4, end: 18, text: 'Revenue dipped' },
		});
	});
});

function ask(text: string) {
	const input = screen.getAllByRole('textbox')[0];
	fireEvent.change(input, { target: { value: text } });
	fireEvent.keyDown(input, { key: 'Enter' });
}
