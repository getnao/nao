// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSyncMessages } from './use-agent';
import type { AgentState } from './use-agent';

const mocks = vi.hoisted(() => {
	Object.defineProperty(URL, 'createObjectURL', {
		configurable: true,
		value: vi.fn(() => 'blob:test'),
	});

	return {
		contextChatId: undefined as string | undefined,
		setChat: vi.fn(),
		useChatQuery: vi.fn(() => ({ data: undefined })),
	};
});

vi.mock('./use-chat-id', () => ({
	useChatId: () => mocks.contextChatId,
}));

vi.mock('@/queries/use-chat-query', () => ({
	useChatQuery: mocks.useChatQuery,
	useSetChat: () => mocks.setChat,
}));

vi.mock('@/main', () => ({ trpc: {} }));

afterEach(() => {
	cleanup();
	mocks.contextChatId = undefined;
	vi.clearAllMocks();
});

describe('useSyncMessages', () => {
	it('uses the agent chat ID for onboarding message snapshots', () => {
		const agent = {
			chatId: 'onboarding-chat',
			mode: 'onboarding',
			messages: [{ id: 'message-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
			isRunning: true,
			setMessages: vi.fn(),
		} as unknown as AgentState;

		renderHook(() => useSyncMessages({ agent }));

		expect(mocks.useChatQuery).toHaveBeenCalledWith({ chatId: 'onboarding-chat' });
		expect(mocks.setChat).toHaveBeenCalledWith({ chatId: 'onboarding-chat' }, expect.any(Function));
	});

	it('keeps using the route chat ID for regular chat navigation', () => {
		mocks.contextChatId = 'route-chat';
		const agent = {
			chatId: 'previous-chat',
			mode: 'default',
			messages: [],
			isRunning: false,
			setMessages: vi.fn(),
		} as unknown as AgentState;

		renderHook(() => useSyncMessages({ agent }));

		expect(mocks.useChatQuery).toHaveBeenCalledWith({ chatId: 'route-chat' });
	});
});
