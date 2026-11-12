// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '../helpers/query-client';
import type { ReactNode } from 'react';

import type { SubmittedMessage } from '@/hooks/use-agent';
import { AutomationChatPanel } from '@/components/automation-chat-panel';
import { TooltipProvider } from '@/components/ui/tooltip';
import { chatInputRestoreStore } from '@/stores/chat-input-restore';

const FIRST_MESSAGE = 'Run it on weekdays at 8am instead, from @[orders]';
const ORDERS_MENTION = { id: 'orders', label: 'orders', trigger: '@' };
const SUGGESTION = 'Why did the last runs fail?';

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
vi.mock('@/components/chat-input', async () => {
	const { useState } = await import('react');
	const { FollowUpFiller } = await import('@/contexts/set-chat-input-callback');

	function ChatInput({ onSubmitMessage }: { onSubmitMessage?: (message: SubmittedMessage) => Promise<void> }) {
		const [text, setText] = useState('');
		const submit = () => {
			void onSubmitMessage?.({ text: FIRST_MESSAGE, mentions: [ORDERS_MENTION] });
		};

		return (
			<>
				<FollowUpFiller onFill={setText} />
				<output aria-label='Message'>{text}</output>
				<button type='button' onClick={submit}>
					Send
				</button>
			</>
		);
	}

	return { ChatInput };
});
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
		chatInputRestoreStore.clear();
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

	it('writes a picked suggestion in the input, without sending it', async () => {
		renderPanel({ automationId: 'automation-1' });

		fireEvent.click(await screen.findByRole('button', { name: SUGGESTION }));

		expect(screen.getByRole('status', { name: 'Message' }).textContent).toBe(SUGGESTION);
		expect(startEditChat).not.toHaveBeenCalled();
	});

	it('gives the message back to the input when the conversation fails to start', async () => {
		startEditChat.mockRejectedValueOnce(new Error('offline'));
		renderPanel({ automationId: 'automation-1' });

		fireEvent.click(await screen.findByRole('button', { name: 'Send' }));

		expect(await screen.findByRole('alert')).toBeDefined();
		expect(chatInputRestoreStore.getSnapshot()).toEqual({
			text: FIRST_MESSAGE,
			images: [],
			documents: [],
			mentions: [ORDERS_MENTION],
		});
	});

	it('leaves other chat inputs alone when the start fails after the panel is gone', async () => {
		const start = deferStart();
		const { unmount } = renderPanel({ automationId: 'automation-1' });
		fireEvent.click(await screen.findByRole('button', { name: 'Send' }));
		await waitFor(() => expect(startEditChat).toHaveBeenCalled());

		unmount();
		await start.fail();

		expect(chatInputRestoreStore.getSnapshot()).toBeUndefined();
	});
});

/** Holds the next start pending until the test fails it, then waits for the failure to be handled. */
function deferStart() {
	let reject = (_error: Error) => {};
	startEditChat.mockImplementationOnce(() => {
		return new Promise((_resolve, rejectStart) => {
			reject = rejectStart;
		});
	});

	return {
		fail: async () => {
			reject(new Error('offline'));
			await new Promise((resolve) => setTimeout(resolve));
		},
	};
}

function renderPanel(props: { automationId?: string; onChatStarted?: (chatId: string) => void }) {
	const queryClient = createTestQueryClient();
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
