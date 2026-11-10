// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutomationChatPanel } from './automation-chat-panel';
import type { ReactNode } from 'react';

import type { SubmittedMessage } from '@/hooks/use-agent';
import { TooltipProvider } from '@/components/ui/tooltip';

const FIRST_MESSAGE = 'Run it on weekdays at 8am instead';

const { startEditChat } = vi.hoisted(() => ({
	startEditChat: vi.fn(async (_input: { automationId?: string }) => ({ chatId: 'chat-1' })),
}));

vi.mock('@/main', () => ({
	trpc: {
		automation: {
			latestEditChat: {
				queryOptions: (input: { automationId: string }) => ({
					queryKey: ['automation.latestEditChat', input],
					queryFn: async () => ({ chatId: null }),
				}),
			},
			startEditChat: { mutationOptions: () => ({ mutationFn: startEditChat }) },
		},
	},
}));
vi.mock('@/components/chat-input', () => ({
	ChatInput: ({ onSubmitMessage }: { onSubmitMessage?: (message: SubmittedMessage) => Promise<void> }) => (
		<button type='button' onClick={() => void onSubmitMessage?.({ text: FIRST_MESSAGE, mentions: [] })}>
			Send
		</button>
	),
}));
vi.mock('@/components/ask-bar', () => ({
	PendingMessageSender: ({ message }: { message?: SubmittedMessage }) => (
		<p>{message ? `Sending: ${message.text}` : 'Nothing to send'}</p>
	),
}));
vi.mock('@/contexts/agent.provider', () => ({
	AgentProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/chat-messages/chat-messages', () => ({ ChatMessagesContent: () => null }));
vi.mock('@/components/ui/conversation', () => ({
	Conversation: ({ children }: { children: ReactNode }) => children,
	ConversationContent: ({ children }: { children: ReactNode }) => children,
	ConversationScrollButton: () => null,
}));
vi.mock('@/hooks/use-automation-draft-updates', () => ({ useAutomationDraftUpdates: () => undefined }));

describe('AutomationChatPanel', () => {
	afterEach(() => {
		cleanup();
		startEditChat.mockClear();
	});

	it('starts the conversation of a saved automation with its first message', async () => {
		renderPanel({ automationId: 'automation-1' });

		fireEvent.click(await screen.findByRole('button', { name: 'Send' }));

		expect(await screen.findByText(`Sending: ${FIRST_MESSAGE}`)).toBeDefined();
		expect(startEditChat.mock.calls[0][0]).toEqual({ automationId: 'automation-1' });
	});

	it('reports the conversation started for a new automation', async () => {
		const onChatStarted = vi.fn();
		renderPanel({ onChatStarted });

		fireEvent.click(await screen.findByRole('button', { name: 'Send' }));

		expect(await screen.findByText(`Sending: ${FIRST_MESSAGE}`)).toBeDefined();
		expect(onChatStarted).toHaveBeenCalledWith('chat-1');
	});

	it('suggests what to ask until the conversation starts', async () => {
		renderPanel({ automationId: 'automation-1' });

		expect(await screen.findByText('Why did the last runs fail?')).toBeDefined();
	});
});

function renderPanel(props: { automationId?: string; onChatStarted?: (chatId: string) => void }) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<AutomationChatPanel
					{...props}
					formHandleRef={{ current: null }}
					isOpen
					onOpenChange={() => undefined}
				/>
			</TooltipProvider>
		</QueryClientProvider>,
	);
}
