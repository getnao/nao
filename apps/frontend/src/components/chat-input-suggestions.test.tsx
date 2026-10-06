// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatInputSuggestions } from './chat-input-suggestions';

const mocks = vi.hoisted(() => ({
	messages: [] as unknown[],
	queueOrSendMessage: vi.fn(),
	submitFeedback: vi.fn(),
	inactivityDelays: [] as number[],
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
vi.mock('@/hooks/use-inactivity-trigger', () => ({
	useInactivityTrigger: ({ delayMs }: { delayMs: number }) => {
		mocks.inactivityDelays.push(delayMs);
		return true;
	},
}));
vi.mock('@/hooks/use-story-ids', () => ({ useStoryIds: () => [] }));
vi.mock('@/lib/charts.utils', () => ({ countDisplayCharts: () => 2 }));
vi.mock('@/lib/ai', () => ({
	checkAssistantMessageHasContent: () => true,
	NEW_CHAT_ID: 'new',
}));
vi.mock('@/components/chat-messages/assistant-message-actions', () => ({
	FeedbackDialog: () => null,
	NegativeFeedbackDialog: () => null,
}));
vi.mock('@/components/side-panel/live-story-settings-dialog', () => ({
	LiveStorySettingsDialog: () => null,
}));
vi.mock('@/components/side-panel/hooks/use-story-viewer-live-settings', () => ({
	useStoryViewerLiveSettings: () => ({
		storyId: null,
		isLive: false,
		isLiveTextDynamic: true,
		cacheSchedule: null,
		cacheScheduleDescription: null,
		isUpdating: false,
		isRefreshing: false,
		handleSaveSettings: vi.fn(),
		handleRefreshData: vi.fn(),
	}),
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
	localStorage.clear();
	mocks.inactivityDelays = [];
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

	describe('conversation feedback dismissal', () => {
		it('hides the prompt for the chat and pushes the next prompt further out', () => {
			render(<ChatInputSuggestions storyCreationEnabled={false} />);
			expect(mocks.inactivityDelays.at(-1)).toBe(10_000);

			fireEvent.click(screen.getByLabelText('Dismiss'));

			expect(screen.queryByText('How did this conversation go?')).toBeNull();
			expect(mocks.inactivityDelays.at(-1)).toBe(15_000);
			expect(JSON.parse(localStorage.getItem('nao-feedback-prompt-dismiss-count') ?? '0')).toBe(1);
			expect(JSON.parse(localStorage.getItem('nao-feedback-prompt-dismissed-chats') ?? '[]')).toEqual(['chat-1']);
		});

		it('never shows the prompt again for a chat dismissed in a previous session', () => {
			localStorage.setItem('nao-feedback-prompt-dismissed-chats', JSON.stringify(['chat-1']));

			render(<ChatInputSuggestions storyCreationEnabled={false} />);

			expect(screen.queryByText('How did this conversation go?')).toBeNull();
		});

		it('keeps escalating the delay across sessions and caps it', () => {
			localStorage.setItem('nao-feedback-prompt-dismiss-count', JSON.stringify(2));
			const { unmount } = render(<ChatInputSuggestions storyCreationEnabled={false} />);
			expect(mocks.inactivityDelays.at(-1)).toBe(25_000);
			unmount();

			localStorage.setItem('nao-feedback-prompt-dismiss-count', JSON.stringify(50));
			render(<ChatInputSuggestions storyCreationEnabled={false} />);
			expect(mocks.inactivityDelays.at(-1)).toBe(60_000);
		});
	});
});
