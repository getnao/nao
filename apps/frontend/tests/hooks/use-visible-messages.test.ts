// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { UIMessage } from '@nao/backend/chat';

import { useVisibleMessages } from '@/hooks/use-visible-messages';

describe('useVisibleMessages', () => {
	it('hides forked messages and superseded SQL parts', () => {
		const { userMessage, editedQueryMessage, rerunQueryMessage } = buildConversation();
		const forkedMessage = buildMessage({ id: 'forked', role: 'assistant', isForked: true });

		const { result } = renderHook(() =>
			useVisibleMessages([userMessage, editedQueryMessage, rerunQueryMessage, forkedMessage]),
		);

		expect(result.current.map((message) => message.id)).toEqual(['user', 'edited', 'rerun']);
		expect(result.current[1].parts).toEqual([editedQueryMessage.parts[1]]);
	});

	it('keeps the same objects for unchanged messages while a new message streams', () => {
		const { userMessage, editedQueryMessage, rerunQueryMessage } = buildConversation();
		const { result, rerender } = renderHook(({ messages }) => useVisibleMessages(messages), {
			initialProps: { messages: [userMessage, editedQueryMessage, rerunQueryMessage] },
		});
		const settledMessages = result.current;

		const streamingMessage = buildMessage({ id: 'streaming', role: 'assistant', parts: [textPart('Hel')] });
		rerender({ messages: [userMessage, editedQueryMessage, rerunQueryMessage, streamingMessage] });
		const firstChunkMessages = result.current;

		const nextChunk = { ...streamingMessage, parts: [textPart('Hello')] } as UIMessage;
		rerender({ messages: [userMessage, editedQueryMessage, rerunQueryMessage, nextChunk] });

		settledMessages.forEach((message, index) => {
			expect(firstChunkMessages[index]).toBe(message);
			expect(result.current[index]).toBe(message);
		});
		expect(result.current[3]).toBe(nextChunk);
	});

	it('returns a new object when a message changes', () => {
		const { userMessage, editedQueryMessage, rerunQueryMessage } = buildConversation();
		const { result, rerender } = renderHook(({ messages }) => useVisibleMessages(messages), {
			initialProps: { messages: [userMessage, editedQueryMessage, rerunQueryMessage] },
		});
		const firstVisibleMessages = result.current;

		const votedMessage = { ...editedQueryMessage, feedback: { vote: 'up' } } as UIMessage;
		rerender({ messages: [userMessage, votedMessage, rerunQueryMessage] });

		expect(result.current[1]).not.toBe(firstVisibleMessages[1]);
		expect(result.current[1].feedback).toEqual({ vote: 'up' });
		expect(result.current[2]).toBe(firstVisibleMessages[2]);
	});
});

function buildConversation() {
	const userMessage = buildMessage({ id: 'user', role: 'user', parts: [textPart('Show revenue')] });
	const editedQueryMessage = buildMessage({
		id: 'edited',
		role: 'assistant',
		parts: [sqlPart('query-1'), textPart('Here is the revenue')],
	});
	const rerunQueryMessage = buildMessage({ id: 'rerun', role: 'assistant', parts: [sqlPart('query-1')] });
	return { userMessage, editedQueryMessage, rerunQueryMessage };
}

function buildMessage(message: { id: string; role: 'user' | 'assistant'; parts?: unknown[]; isForked?: boolean }) {
	return { parts: [], ...message } as unknown as UIMessage;
}

function textPart(text: string) {
	return { type: 'text', text };
}

function sqlPart(queryId: string) {
	return { type: 'tool-execute_sql', state: 'output-available', output: { id: queryId } };
}
