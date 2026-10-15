import { describe, expect, it, vi } from 'vitest';

import type { UIMessage } from '@nao/backend/chat';
import { getLatestRelevantStoryAgentState } from '@/components/side-panel/hooks/use-story-viewer-agent-state';

vi.mock('@/contexts/agent.provider', () => ({
	useAgentMessages: vi.fn(),
	useOptionalAgentContext: vi.fn(),
}));

describe('getLatestRelevantStoryAgentState', () => {
	it.each<[string, Partial<StoryMessageOptions>, boolean, ReturnType<typeof getLatestRelevantStoryAgentState>]>([
		[
			'treats a stopped streaming story without a stop reason as interrupted',
			{},
			false,
			{ isStoryStreaming: true, isStoryInterrupted: true },
		],
		[
			'keeps an actively streaming story uninterrupted',
			{},
			true,
			{ isStoryStreaming: true, isStoryInterrupted: false },
		],
		[
			'detects a persisted interrupted streaming story part',
			{ stopReason: 'interrupted' },
			true,
			{ isStoryStreaming: false, isStoryInterrupted: true },
		],
		[
			'detects a persisted interrupted story settled with an output error',
			{ stopReason: 'interrupted', state: 'output-error' },
			false,
			{ isStoryStreaming: false, isStoryInterrupted: true },
		],
		[
			'keeps a completed story on an interrupted message uninterrupted',
			{ stopReason: 'interrupted', state: 'output-available' },
			false,
			{ isStoryStreaming: false, isStoryInterrupted: false },
		],
	])('%s', (_scenario, message, isRunning, expected) => {
		const messages = [createStoryMessage(message)];

		expect(getLatestRelevantStoryAgentState(messages, 'test-long', isRunning)).toEqual(expected);
	});

	it('uses the newest matching story part', () => {
		const messages = [
			createStoryMessage({ stopReason: 'interrupted' }),
			createStoryMessage({ messageId: 'message-2' }),
		];

		expect(getLatestRelevantStoryAgentState(messages, 'test-long', true)).toEqual({
			isStoryStreaming: true,
			isStoryInterrupted: false,
		});
	});
});

interface StoryMessageOptions {
	messageId: string;
	storySlug: string;
	stopReason?: 'interrupted';
	state: 'input-streaming' | 'output-error' | 'output-available';
}

function createStoryMessage({
	messageId = 'message-1',
	storySlug = 'test-long',
	stopReason,
	state = 'input-streaming',
}: Partial<StoryMessageOptions>) {
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
