import { describe, expect, it } from 'vitest';

import { findStoryDraft } from './story.utils';

import type { UIMessage } from '@nao/backend/chat';

describe('findStoryDraft', () => {
	it('falls back to the last successful version when the latest story call failed', () => {
		const messages = [
			createStoryMessage({
				messageId: 'message-1',
				state: 'output-available',
				input: { id: 'sales', action: 'create', code: '# v1' },
				output: { success: true, id: 'sales', title: 'Sales', code: '# v1', version: 1 },
			}),
			createStoryMessage({
				messageId: 'message-2',
				state: 'output-error',
				input: { id: 'sales', action: 'replace', code: '# v2 cut off mid' },
			}),
		];

		expect(findStoryDraft(messages, 'sales')).toEqual({
			id: 'sales',
			title: 'Sales',
			code: '# v1',
			isStreaming: false,
		});
	});

	it('returns no draft when the only story call failed', () => {
		const messages = [
			createStoryMessage({
				messageId: 'message-1',
				state: 'output-error',
				input: { id: 'sales', action: 'create', code: '# cut off mid' },
			}),
		];

		expect(findStoryDraft(messages, 'sales')).toBeNull();
	});

	it('prefers the streaming input of an in-progress call', () => {
		const messages = [
			createStoryMessage({
				messageId: 'message-1',
				state: 'input-streaming',
				input: { id: 'sales', action: 'create', title: 'Sales', code: '# streaming' },
			}),
		];

		expect(findStoryDraft(messages, 'sales')).toEqual({
			id: 'sales',
			title: 'Sales',
			code: '# streaming',
			isStreaming: true,
		});
	});
});

function createStoryMessage({
	messageId,
	state,
	input,
	output,
}: {
	messageId: string;
	state: 'input-streaming' | 'output-error' | 'output-available';
	input: Record<string, unknown>;
	output?: Record<string, unknown>;
}) {
	return {
		id: messageId,
		role: 'assistant',
		parts: [{ type: 'tool-story', toolCallId: messageId, state, input, output }],
	} as unknown as UIMessage;
}
