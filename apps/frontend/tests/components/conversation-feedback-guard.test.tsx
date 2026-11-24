// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UIMessage } from '@nao/backend/chat';
import { ConversationFeedbackGuard } from '@/components/conversation-feedback-guard';

const mocks = vi.hoisted(() => ({
	agentSettings: { requireConversationFeedback: true },
	features: { 'conversation-feedback': true },
	isCloud: false,
	isRunning: false,
	isReadonly: false,
	mode: 'default',
	messages: [] as UIMessage[],
	mutate: vi.fn(),
	proceed: vi.fn(),
	reset: vi.fn(),
	submitFails: false,
	isSubmitError: false,
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
		onError?: () => void;
		onSettled?: () => void;
	}) => ({
		mutate: (variables: { chatId: string; messageId: string; vote: 'up' | 'down' }) => {
			mocks.mutate(variables);
			if (mocks.submitFails) {
				mocks.isSubmitError = true;
				options.onError?.();
			} else {
				options.onSuccess({ messageId: variables.messageId, vote: variables.vote }, variables, undefined, {
					client: {
						setQueryData: vi.fn(),
						invalidateQueries: vi.fn(),
					},
				});
			}
			options.onSettled?.();
		},
		reset: () => {
			mocks.isSubmitError = false;
		},
		isPending: false,
		isError: mocks.isSubmitError,
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
		mocks.features['conversation-feedback'] = true;
		mocks.isCloud = false;
		mocks.isRunning = false;
		mocks.isReadonly = false;
		mocks.mode = 'default';
		mocks.messages = [assistantMessage('answer-1')];
		mocks.mutate.mockReset();
		mocks.proceed.mockReset();
		mocks.reset.mockReset();
		mocks.submitFails = false;
		mocks.isSubmitError = false;
		mocks.isNavigationAllowed = false;
	});

	afterEach(cleanup);

	it('keeps the prompt open after voting and continues navigation once feedback is submitted', () => {
		render(<ConversationFeedbackGuard chatId='chat-1' />);

		fireEvent.click(screen.getByRole('button', { name: 'Good conversation' }));

		expect(mocks.mutate).not.toHaveBeenCalled();
		expect(mocks.proceed).not.toHaveBeenCalled();

		fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Useful answer  ' } });
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

		expect(mocks.mutate).toHaveBeenCalledWith({
			chatId: 'chat-1',
			messageId: 'answer-1',
			vote: 'up',
			explanation: 'Useful answer',
		});
		expect(mocks.proceed).toHaveBeenCalledOnce();
	});

	it('allows navigation after the latest answer has been rated', () => {
		mocks.messages = [assistantMessage('answer-1', 'down')];

		render(<ConversationFeedbackGuard chatId='chat-1' />);

		expect(mocks.blockerOptions?.disabled).toBe(false);
		expect(mocks.blockerOptions?.shouldBlockFn({ next: { pathname: '/settings/account' } })).toBe(false);
	});

	it('stays in the conversation when the prompt is closed', () => {
		render(<ConversationFeedbackGuard chatId='chat-1' />);

		fireEvent.keyDown(document, { key: 'Escape' });

		expect(mocks.reset).toHaveBeenCalledOnce();
		expect(mocks.proceed).not.toHaveBeenCalled();
	});

	it('continues navigation without feedback when skipped', () => {
		render(<ConversationFeedbackGuard chatId='chat-1' />);

		fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

		expect(mocks.mutate).not.toHaveBeenCalled();
		expect(mocks.proceed).toHaveBeenCalledOnce();
	});

	it('keeps the prompt open with an error when submitting fails', () => {
		mocks.submitFails = true;
		const { rerender } = render(<ConversationFeedbackGuard chatId='chat-1' />);

		fireEvent.click(screen.getByRole('button', { name: 'Bad conversation' }));
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
		rerender(<ConversationFeedbackGuard chatId='chat-1' />);

		expect(mocks.proceed).not.toHaveBeenCalled();
		expect(screen.getByRole('alert').textContent).toContain("Couldn't send your feedback");
	});

	it('does not prompt while the latest answer is generating', () => {
		mocks.isRunning = true;
		render(<ConversationFeedbackGuard chatId='chat-1' />);

		expect(mocks.blockerOptions?.shouldBlockFn({ next: { pathname: '/settings/account' } })).toBe(false);
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
