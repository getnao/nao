// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatInputSuggestions } from './chat-input-suggestions';
import type { UIMessage } from '@nao/backend/chat';

const FEEDBACK_PROMPT = 'How did this conversation go?';
const INITIAL_DELAY = 10_000;
const IGNORED_DELAY = 20_000;

const messages = [
	{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'How many users signed up?' }] },
	{ id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: '42 users signed up.' }] },
] as unknown as UIMessage[];

vi.mock('@/contexts/agent.provider', () => ({
	useAgentContext: () => ({
		isReadonly: false,
		isRunning: false,
		messages,
		queueOrSendMessage: vi.fn(),
	}),
}));

vi.mock('@/hooks/use-chat-id', () => ({
	useChatId: () => 'chat-1',
}));

vi.mock('./chat-messages/assistant-message-actions', () => ({
	NegativeFeedbackDialog: () => null,
}));

vi.mock('@/main', () => ({
	trpc: {
		feedback: { submit: { mutationOptions: () => ({ mutationFn: async () => ({}) }) } },
	},
}));

function renderSuggestions() {
	const queryClient = new QueryClient();
	const view = render(
		<QueryClientProvider client={queryClient}>
			<ChatInputSuggestions isUserTyping={false} />
		</QueryClientProvider>,
	);

	return {
		setTyping: (isUserTyping: boolean) =>
			view.rerender(
				<QueryClientProvider client={queryClient}>
					<ChatInputSuggestions isUserTyping={isUserTyping} />
				</QueryClientProvider>,
			),
	};
}

function advance(ms: number) {
	act(() => {
		vi.advanceTimersByTime(ms);
	});
}

function isFeedbackPromptVisible() {
	return screen.queryByText(FEEDBACK_PROMPT) !== null;
}

class ResizeObserverStub {
	observe() {}
	unobserve() {}
	disconnect() {}
}

describe('ChatInputSuggestions conversation feedback', () => {
	beforeEach(() => {
		vi.stubGlobal('ResizeObserver', ResizeObserverStub);
		vi.useFakeTimers();
	});
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('asks for feedback after the chat has been idle', () => {
		renderSuggestions();

		advance(INITIAL_DELAY - 1);
		expect(isFeedbackPromptVisible()).toBe(false);

		advance(1);
		expect(isFeedbackPromptVisible()).toBe(true);
	});

	it('stays hidden after the user types and clears the input, then returns after the longer delay', () => {
		const { setTyping } = renderSuggestions();

		advance(INITIAL_DELAY);
		expect(isFeedbackPromptVisible()).toBe(true);

		setTyping(true);
		expect(isFeedbackPromptVisible()).toBe(false);

		setTyping(false);
		expect(isFeedbackPromptVisible()).toBe(false);

		advance(INITIAL_DELAY);
		expect(isFeedbackPromptVisible()).toBe(false);

		advance(IGNORED_DELAY - INITIAL_DELAY);
		expect(isFeedbackPromptVisible()).toBe(true);
	});

	it('keeps the initial delay when the user types before the prompt appears', () => {
		const { setTyping } = renderSuggestions();

		advance(INITIAL_DELAY - 1);
		setTyping(true);
		advance(INITIAL_DELAY);
		expect(isFeedbackPromptVisible()).toBe(false);

		setTyping(false);
		advance(INITIAL_DELAY);
		expect(isFeedbackPromptVisible()).toBe(true);
	});
});
