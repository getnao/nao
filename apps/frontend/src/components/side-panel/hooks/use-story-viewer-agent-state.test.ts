import { describe, expect, it, vi } from 'vitest';

import { getLatestRelevantStoryAgentState } from './use-story-viewer-agent-state';

import type { UIMessage } from '@nao/backend/chat';

vi.mock('@/contexts/agent.provider', () => ({
	useAgentMessages: vi.fn(),
	useOptionalAgentContext: vi.fn(),
}));

describe('getLatestRelevantStoryAgentState', () => {
	it('treats a stopped streaming story without a stop reason as interrupted', () => {
		const messages = [
			createStoryMessage({
				messageId: 'message-1',
				storySlug: 'test-long',
			}),
		];

		expect(getLatestRelevantStoryAgentState(messages, 'test-long', false)).toEqual({
			isStoryStreaming: true,
			isStoryInterrupted: true,
		});
	});

	it('keeps an actively streaming story uninterrupted', () => {
		const messages = [
			createStoryMessage({
				messageId: 'message-1',
				storySlug: 'test-long',
			}),
		];

		expect(getLatestRelevantStoryAgentState(messages, 'test-long', true)).toEqual({
			isStoryStreaming: true,
			isStoryInterrupted: false,
		});
	});

	it('detects a persisted interrupted streaming story part', () => {
		const messages = [
			createStoryMessage({
				messageId: 'message-1',
				storySlug: 'test-long',
				stopReason: 'interrupted',
			}),
		];

		expect(getLatestRelevantStoryAgentState(messages, 'test-long', true)).toEqual({
			isStoryStreaming: false,
			isStoryInterrupted: true,
		});
	});

	it('detects a persisted interrupted story settled with an output error', () => {
		const messages = [
			createStoryMessage({
				messageId: 'message-1',
				storySlug: 'test-long',
				stopReason: 'interrupted',
				state: 'output-error',
			}),
		];

		expect(getLatestRelevantStoryAgentState(messages, 'test-long', false)).toEqual({
			isStoryStreaming: false,
			isStoryInterrupted: true,
		});
	});

	it('keeps a completed story on an interrupted message uninterrupted', () => {
		const messages = [
			createStoryMessage({
				messageId: 'message-1',
				storySlug: 'test-long',
				stopReason: 'interrupted',
				state: 'output-available',
			}),
		];

		expect(getLatestRelevantStoryAgentState(messages, 'test-long', false)).toEqual({
			isStoryStreaming: false,
			isStoryInterrupted: false,
		});
	});

	it('uses the newest matching story part', () => {
		const messages = [
			createStoryMessage({
				messageId: 'message-1',
				storySlug: 'test-long',
				stopReason: 'interrupted',
			}),
			createStoryMessage({
				messageId: 'message-2',
				storySlug: 'test-long',
			}),
		];

		expect(getLatestRelevantStoryAgentState(messages, 'test-long', true)).toEqual({
			isStoryStreaming: true,
			isStoryInterrupted: false,
		});
	});
});

function createStoryMessage({
	messageId,
	storySlug,
	stopReason,
	state = 'input-streaming',
}: {
	messageId: string;
	storySlug: string;
	stopReason?: 'interrupted';
	state?: 'input-streaming' | 'output-error' | 'output-available';
}) {
	return {
		id: messageId,
		role: 'assistant',
		stopReason,
		parts: [
			{
				type: 'tool-story',
				state,
				input: { id: storySlug },
			},
		],
	} as unknown as UIMessage;
}
