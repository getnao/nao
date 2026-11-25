// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UIMessage } from '@nao/backend/chat';
import { ChatHeaderFeedback, ConversationFeedbackGuard } from '@/components/chat-header-feedback';

const mocks = vi.hoisted(() => ({
	isFeedbackRequired: true,
	isRunning: false,
	messages: [] as UIMessage[],
	mutate: vi.fn(),
	resetMutation: vi.fn(),
	proceed: vi.fn(),
	resetNavigation: vi.fn(),
	submitFails: false,
	blockerOptions: undefined as
		| {
				disabled?: boolean;
				shouldBlockFn: (args: { next: { pathname: string } }) => boolean;
		  }
		| undefined,
}));

vi.mock('@/components/chat-messages/assistant-message-actions', () => ({
	FEEDBACK_VOTES: ['up', 'down'],
	FeedbackButton: ({
		vote,
		subject = 'response',
		isSelected,
		disabled,
		onClick,
	}: {
		vote: 'up' | 'down';
		subject?: string;
		isSelected: boolean;
		disabled: boolean;
		onClick: () => void;
	}) => (
		<button type='button' aria-pressed={isSelected} disabled={disabled} onClick={onClick}>
			{vote === 'up' ? 'Good' : 'Bad'} {subject}
		</button>
	),
	FeedbackDialog: ({
		open,
		onOpenChange,
		onSubmit,
		onSkip,
		defaultVote,
		error,
	}: {
		open: boolean;
		onOpenChange: (open: boolean) => void;
		onSubmit: (explanation: string | undefined, vote: 'up' | 'down') => void;
		onSkip?: () => void;
		defaultVote?: 'up' | 'down';
		error?: string;
	}) =>
		open ? (
			<div role='dialog'>
				{error && <p role='alert'>{error}</p>}
				<button type='button' onClick={() => onSubmit('Useful answer', defaultVote ?? 'up')}>
					Submit
				</button>
				<button type='button' onClick={() => onOpenChange(false)}>
					Close
				</button>
				{onSkip && (
					<button type='button' onClick={onSkip}>
						Skip
					</button>
				)}
			</div>
		) : null,
}));

vi.mock('@/contexts/agent.provider', () => ({
	useAgentContext: () => ({ isRunning: mocks.isRunning }),
	useAgentMessagesSelector: (selector: (messages: UIMessage[]) => unknown) => selector(mocks.messages),
}));

vi.mock('@/hooks/use-message-feedback', () => ({
	useIsConversationFeedbackRequired: () => mocks.isFeedbackRequired,
	useSubmitMessageFeedback: (onSuccess?: (vote: 'up' | 'down') => void) => ({
		mutate: (variables: { vote: 'up' | 'down' }) => {
			mocks.mutate(variables);
			if (!mocks.submitFails) {
				onSuccess?.(variables.vote);
			}
		},
		reset: mocks.resetMutation,
		isPending: false,
		isError: mocks.submitFails,
	}),
}));

vi.mock('@tanstack/react-router', () => ({
	useBlocker: (options: { disabled?: boolean; shouldBlockFn: (args: { next: { pathname: string } }) => boolean }) => {
		mocks.blockerOptions = options;
		return {
			status: options.disabled ? 'idle' : 'blocked',
			proceed: mocks.proceed,
			reset: mocks.resetNavigation,
		};
	},
}));

beforeEach(() => {
	mocks.isFeedbackRequired = true;
	mocks.isRunning = false;
	mocks.messages = [assistantMessage('answer-1')];
	mocks.mutate.mockReset();
	mocks.resetMutation.mockReset();
	mocks.proceed.mockReset();
	mocks.resetNavigation.mockReset();
	mocks.submitFails = false;
	mocks.blockerOptions = undefined;
});

afterEach(cleanup);

describe('ChatHeaderFeedback', () => {
	it.each([
		['feedback is optional', () => (mocks.isFeedbackRequired = false)],
		['there is no assistant answer', () => (mocks.messages = [])],
	])('hides the controls when %s', (_, arrange) => {
		arrange();
		render(<ChatHeaderFeedback chatId='chat-1' />);

		expect(screen.queryByRole('button', { name: 'Good conversation' })).toBeNull();
	});

	it('submits feedback for the latest assistant answer', () => {
		mocks.messages = [assistantMessage('answer-1'), assistantMessage('answer-2')];
		render(<ChatHeaderFeedback chatId='chat-1' />);

		fireEvent.click(screen.getByRole('button', { name: 'Good conversation' }));
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

		expect(mocks.mutate).toHaveBeenCalledWith({
			chatId: 'chat-1',
			messageId: 'answer-2',
			vote: 'up',
			explanation: 'Useful answer',
		});
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('keeps the dialog open when feedback fails to save', () => {
		mocks.submitFails = true;
		render(<ChatHeaderFeedback chatId='chat-1' />);

		fireEvent.click(screen.getByRole('button', { name: 'Bad conversation' }));
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

		expect(screen.getByRole('dialog')).toBeTruthy();
		expect(screen.getByRole('alert').textContent).toContain("Couldn't send your feedback");
	});
});

describe('ConversationFeedbackGuard', () => {
	it('blocks only navigation away from an unrated, idle conversation', () => {
		render(<ConversationFeedbackGuard chatId='chat-1' />);

		expect(mocks.blockerOptions?.shouldBlockFn({ next: { pathname: '/chat-1/subagent/tool-1' } })).toBe(false);
		expect(mocks.blockerOptions?.shouldBlockFn({ next: { pathname: '/settings/account' } })).toBe(true);
	});

	it.each([
		['the answer is rated', () => (mocks.messages = [assistantMessage('answer-1', 'down')])],
		['the answer is running', () => (mocks.isRunning = true)],
	])('allows navigation when %s', (_, arrange) => {
		arrange();
		render(<ConversationFeedbackGuard chatId='chat-1' />);

		expect(mocks.blockerOptions?.shouldBlockFn({ next: { pathname: '/settings/account' } })).toBe(false);
	});

	it('continues navigation after feedback is saved', () => {
		render(<ConversationFeedbackGuard chatId='chat-1' />);

		fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

		expect(mocks.mutate).toHaveBeenCalledWith({
			chatId: 'chat-1',
			messageId: 'answer-1',
			vote: 'up',
			explanation: 'Useful answer',
		});
		expect(mocks.proceed).toHaveBeenCalledOnce();
	});

	it('cancels navigation when dismissed and allows it when skipped', () => {
		render(<ConversationFeedbackGuard chatId='chat-1' />);

		fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		expect(mocks.resetNavigation).toHaveBeenCalledOnce();

		fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
		expect(mocks.proceed).toHaveBeenCalledOnce();
	});

	it('stays blocked when feedback fails to save', () => {
		mocks.submitFails = true;
		render(<ConversationFeedbackGuard chatId='chat-1' />);

		fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

		expect(mocks.proceed).not.toHaveBeenCalled();
		expect(screen.getByRole('alert').textContent).toContain("Couldn't send your feedback");
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
