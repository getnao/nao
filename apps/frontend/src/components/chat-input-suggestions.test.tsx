// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatInputSuggestions } from './chat-input-suggestions';

let triggerResizeObservers: () => void;

const mocks = vi.hoisted(() => ({
	messages: [] as unknown[],
	queueOrSendMessage: vi.fn(),
	submitFeedback: vi.fn(),
	inactivityDelays: [] as number[],
	storyId: null as string | null,
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
		storyId: mocks.storyId,
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
	mocks.storyId = null;
	mocks.messages = [{ id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'Result' }] }];
	const observerCallbacks = new Map<ResizeObserver, ResizeObserverCallback>();
	globalThis.ResizeObserver = class {
		constructor(callback: ResizeObserverCallback) {
			observerCallbacks.set(this, callback);
		}
		observe() {
			observerCallbacks.get(this)?.([], this);
		}
		unobserve() {}
		disconnect() {
			observerCallbacks.delete(this);
		}
		takeRecords() {
			return [];
		}
	};
	triggerResizeObservers = () => {
		observerCallbacks.forEach((callback, observer) => callback([], observer));
	};
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

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

	it('makes a collapsed suggestion inert', () => {
		const { container, rerender } = render(<ChatInputSuggestions storyCreationEnabled />);
		const panel = container.firstElementChild;

		expect(panel?.hasAttribute('inert')).toBe(false);

		rerender(<ChatInputSuggestions storyCreationEnabled isHidden />);

		expect(panel?.hasAttribute('inert')).toBe(true);
	});

	it('only expands a live Story description when it is truncated', () => {
		mocks.storyId = 'story-1';
		mocks.messages = [
			{
				id: 'assistant-1',
				role: 'assistant',
				parts: [
					{
						type: 'tool-story',
						input: { action: 'create' },
						output: { success: true, version: 1, id: 'story-1' },
					},
				],
			},
		];
		const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(21);
		vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(20);

		render(<ChatInputSuggestions storyCreationEnabled={false} />);
		expect(screen.queryByText('Read more')).toBeNull();

		act(() => {
			scrollHeight.mockReturnValue(40);
			triggerResizeObservers();
		});

		fireEvent.click(screen.getByText('Read more'));
		expect(screen.getByText('Show less')).toBeTruthy();
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
