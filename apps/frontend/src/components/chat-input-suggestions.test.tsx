// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatInputSuggestions } from './chat-input-suggestions';

const mocks = vi.hoisted(() => ({
	messages: [] as unknown[],
	queueOrSendMessage: vi.fn(),
	submitFeedback: vi.fn(),
}));

vi.mock('@/contexts/agent.provider', () => ({
	useAgentContext: () => ({
		isReadonly: false,
		isRunning: false,
		queueOrSendMessage: mocks.queueOrSendMessage,
	}),
	useAgentMessages: () => mocks.messages,
}));
vi.mock('@/hooks/use-chat-id', () => ({ useChatId: () => 'chat-1' }));
vi.mock('@/hooks/use-inactivity-trigger', () => ({ useInactivityTrigger: () => true }));
vi.mock('@/hooks/use-story-ids', () => ({ useStoryIds: () => [] }));
vi.mock('@/lib/charts.utils', () => ({ countDisplayCharts: () => 2 }));
vi.mock('@/lib/ai', () => ({
	checkAssistantMessageHasContent: () => true,
	NEW_CHAT_ID: 'new',
}));
vi.mock('@/components/chat-messages/assistant-message-actions', () => ({
	NegativeFeedbackDialog: () => null,
}));
vi.mock('@tanstack/react-query', () => ({
	useMutation: () => ({ isPending: false, mutate: mocks.submitFeedback }),
}));
vi.mock('@/main', () => ({
	trpc: {
		feedback: { submit: { mutationOptions: vi.fn() } },
		chat: { get: { queryKey: vi.fn() } },
	},
}));

beforeEach(() => {
	mocks.messages = [{ id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'Result' }] }];
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

afterEach(cleanup);

describe('ChatInputSuggestions', () => {
	it('shows the Story suggestion when Story creation is allowed', () => {
		render(<ChatInputSuggestions storyCreationEnabled />);

		expect(screen.getByText('Would you want to create a story?')).toBeTruthy();
		expect(screen.queryByText('How did this conversation go?')).toBeNull();
	});

	it('shows conversation feedback instead of the Story suggestion when Story creation is denied', () => {
		render(<ChatInputSuggestions storyCreationEnabled={false} />);

		expect(screen.queryByText('Would you want to create a story?')).toBeNull();
		expect(screen.getByText('How did this conversation go?')).toBeTruthy();
	});

	it('keeps MCP authentication suggestions when Story creation is denied', () => {
		mocks.messages = [
			{
				id: 'assistant-1',
				role: 'assistant',
				parts: [
					{
						type: 'dynamic-tool',
						output: { mcpAuthRequired: true, server: 'salesforce' },
					},
				],
			},
		];

		render(<ChatInputSuggestions storyCreationEnabled={false} />);

		expect(screen.getByText('Connect your account to "salesforce" to continue')).toBeTruthy();
		expect(screen.queryByText('Would you want to create a story?')).toBeNull();
	});
});
