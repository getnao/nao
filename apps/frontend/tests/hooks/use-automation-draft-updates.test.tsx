// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UIMessage } from '@nao/backend/chat';
import type { AutomationDraftUpdate } from '@nao/shared/automation-draft';
import { useAutomationDraftUpdates } from '@/hooks/use-automation-draft-updates';

const mocks = vi.hoisted(() => ({
	messages: [] as unknown[],
	savedMessages: undefined as unknown[] | undefined,
}));

vi.mock('@/main', () => ({ trpc: {} }));
vi.mock('@/contexts/agent.provider', () => ({ useAgentMessages: () => mocks.messages }));
vi.mock('@/hooks/use-chat-id', () => ({ useChatId: () => 'chat-1' }));
vi.mock('@/queries/use-chat-query', () => ({
	useChatQuery: () => ({ data: mocks.savedMessages ? { messages: mocks.savedMessages } : undefined }),
}));

afterEach(() => {
	cleanup();
	mocks.messages = [];
	mocks.savedMessages = undefined;
});

describe('useAutomationDraftUpdates', () => {
	it('hands each new change over once it is settled', () => {
		const onUpdate = vi.fn();
		const handledUpdates = new Map();
		const { rerender } = renderHook(() =>
			useAutomationDraftUpdates({ isResumed: false, handledUpdates, onUpdate }),
		);

		mocks.messages = [assistantMessage([updatePart('call-1', { title: 'Daily' }, 'input-available')])];
		rerender();
		expect(onUpdate).not.toHaveBeenCalled();

		mocks.messages = [assistantMessage([updatePart('call-1', { title: 'Daily' })])];
		rerender();
		mocks.messages = [...mocks.messages];
		rerender();

		expect(onUpdate).toHaveBeenCalledOnce();
		expect(onUpdate).toHaveBeenCalledWith({ title: 'Daily' });
	});

	it('leaves out the changes a resumed conversation already made', () => {
		const onUpdate = vi.fn();
		const pastMessage = assistantMessage([updatePart('call-1', { title: 'Old' })]);
		mocks.savedMessages = [pastMessage];
		const handledUpdates = new Map();
		const { rerender } = renderHook(() => useAutomationDraftUpdates({ isResumed: true, handledUpdates, onUpdate }));

		mocks.messages = [pastMessage];
		rerender();
		expect(onUpdate).not.toHaveBeenCalled();

		mocks.messages = [pastMessage, assistantMessage([updatePart('call-2', { webhookEnabled: true })])];
		rerender();

		expect(onUpdate).toHaveBeenCalledOnce();
		expect(onUpdate).toHaveBeenCalledWith({ webhookEnabled: true });
	});

	it('does not hand a change over again when the chat is reopened', () => {
		const onUpdate = vi.fn();
		const handledUpdates = new Map();
		mocks.messages = [assistantMessage([updatePart('call-1', { title: 'Daily' })])];
		const firstMount = renderHook(() => useAutomationDraftUpdates({ isResumed: false, handledUpdates, onUpdate }));
		expect(onUpdate).toHaveBeenCalledOnce();

		firstMount.unmount();
		renderHook(() => useAutomationDraftUpdates({ isResumed: false, handledUpdates, onUpdate }));

		expect(onUpdate).toHaveBeenCalledOnce();
	});

	it('ignores failed changes and other tools', () => {
		const onUpdate = vi.fn();
		const handledUpdates = new Map();
		const { rerender } = renderHook(() =>
			useAutomationDraftUpdates({ isResumed: false, handledUpdates, onUpdate }),
		);

		mocks.messages = [
			assistantMessage([
				updatePart('call-1', { title: 'Daily' }, 'output-error'),
				{ type: 'tool-get_automation', toolCallId: 'call-2', state: 'output-available', input: {}, output: {} },
			]),
		];
		rerender();

		expect(onUpdate).not.toHaveBeenCalled();
	});
});

function assistantMessage(parts: unknown[]): UIMessage {
	return { id: crypto.randomUUID(), role: 'assistant', parts } as UIMessage;
}

function updatePart(toolCallId: string, update: AutomationDraftUpdate, state = 'output-available') {
	return {
		type: 'tool-update_automation',
		toolCallId,
		state,
		input: {},
		...(state === 'output-available' && { output: { changedFields: [], update } }),
		...(state === 'output-error' && { errorText: 'Invalid cron' }),
	};
}
