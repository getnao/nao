// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationFeedbackGuard } from './conversation-feedback-guard';
import type { UIMessage } from '@nao/backend/chat';

const mocks = vi.hoisted(() => ({
	agentSettings: {
		requireConversationFeedback: true,
		enforceConversationFeedbackBeforeLeaving: true,
	},
	features: { 'conversation-feedback': true },
	isCloud: false,
	isRunning: false,
	isReadonly: false,
	mode: 'default',
	messages: [] as UIMessage[],
	mutate: vi.fn(),
	proceed: vi.fn(),
	reset: vi.fn(),
	isNavigationAllowed: false,
	blockerOptions: undefined as
		| {
				disabled?: boolean;
				shouldBlockFn: (args: { next: { pathname: string } }) => boolean;
		  }
		| undefined,
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: () => ({ data: mocks.agentSettings }),
	useMutation: (options: {
		onSuccess: (
			data: object,
			variables: { chatId: string; messageId: string; vote: 'up' | 'down' },
			result: undefined,
			context: {
				client: {
					setQueryData: ReturnType<typeof vi.fn>;
					invalidateQueries: ReturnType<typeof vi.fn>;
				};
			},
		) => void;
	}) => ({
		mutate: (variables: { chatId: string; messageId: string; vote: 'up' | 'down' }) => {
			mocks.mutate(variables);
			options.onSuccess({ messageId: variables.messageId, vote: variables.vote }, variables, undefined, {
				client: {
					setQueryData: vi.fn(),
					invalidateQueries: vi.fn(),
				},
			});
		},
		isPending: false,
		isError: false,
	}),
}));

vi.mock('@tanstack/react-router', () => ({
	useBlocker: (options: { disabled?: boolean; shouldBlockFn: (args: { next: { pathname: string } }) => boolean }) => {
		mocks.blockerOptions = options;
		return {
			status: options.disabled ? 'idle' : 'blocked',
			proceed: mocks.proceed,
			reset: mocks.reset,
		};
	},
}));

vi.mock('@/contexts/agent.provider', () => ({
	useAgentContext: () => ({
		isRunning: mocks.isRunning,
		isReadonly: mocks.isReadonly,
		mode: mocks.mode,
	}),
	useAgentMessagesSelector: (selector: (messages: UIMessage[]) => unknown) => selector(mocks.messages),
}));

vi.mock('@/hooks/use-license', () => ({
	useLicenseFeatures: () => ({ data: mocks.features }),
}));

vi.mock('@/hooks/use-nao-mode', () => ({
	useIsCloud: () => mocks.isCloud,
}));

vi.mock('@/lib/conversation-feedback-navigation', () => ({
	isConversationFeedbackNavigationAllowed: () => mocks.isNavigationAllowed,
}));

vi.mock('@/main', () => ({
	trpc: {
		project: {
			getAgentSettings: { queryOptions: () => ({}) },
			getChatReplay: { queryKey: () => ['chat-replay'] },
			getProjectChats: { queryKey: () => ['project-chats'] },
		},
		chat: {
			get: { queryKey: () => ['chat'] },
		},
		feedback: {
			submit: { mutationOptions: (options: unknown) => options },
		},
	},
}));

describe('ConversationFeedbackGuard', () => {
	beforeEach(() => {
		mocks.agentSettings.requireConversationFeedback = true;
		mocks.agentSettings.enforceConversationFeedbackBeforeLeaving = true;
		mocks.features['conversation-feedback'] = true;
		mocks.isCloud = false;
		mocks.isRunning = false;
		mocks.isReadonly = false;
		mocks.mode = 'default';
		mocks.messages = [assistantMessage('answer-1')];
		mocks.mutate.mockReset();
		mocks.proceed.mockReset();
		mocks.reset.mockReset();
		mocks.isNavigationAllowed = false;
	});

	afterEach(cleanup);

	it('rates the latest answer and continues the blocked navigation', () => {
		render(<ConversationFeedbackGuard chatId='chat-1' />);

		fireEvent.click(screen.getByRole('button', { name: 'Good conversation' }));

		expect(mocks.mutate).toHaveBeenCalledWith({
			chatId: 'chat-1',
			messageId: 'answer-1',
			vote: 'up',
		});
		expect(mocks.proceed).toHaveBeenCalledOnce();
	});

	it('does not enforce feedback after the latest answer has been rated', () => {
		mocks.messages = [assistantMessage('answer-1', 'down')];

		render(<ConversationFeedbackGuard chatId='chat-1' />);

		expect(mocks.blockerOptions?.disabled).toBe(true);
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('allows navigation within the chat and after the chat is deleted', () => {
		render(<ConversationFeedbackGuard chatId='chat-1' />);

		expect(mocks.blockerOptions?.shouldBlockFn({ next: { pathname: '/chat-1/subagent/tool-1' } })).toBe(false);
		expect(mocks.blockerOptions?.shouldBlockFn({ next: { pathname: '/settings/account' } })).toBe(true);

		mocks.isNavigationAllowed = true;
		expect(mocks.blockerOptions?.shouldBlockFn({ next: { pathname: '/' } })).toBe(false);
	});
});

function assistantMessage(id: string, vote?: 'up' | 'down'): UIMessage {
	return {
		id,
		role: 'assistant',
		parts: [{ type: 'text', text: 'Answer' }],
		feedback: vote ? { messageId: id, vote } : undefined,
	} as UIMessage;
}
