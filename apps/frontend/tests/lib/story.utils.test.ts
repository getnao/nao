import { describe, expect, it } from 'vitest';

import type { UIMessage } from '@nao/backend/chat';
import { findStoryDraft, holdBackIncompleteStoryBlock } from '@/lib/story.utils';

describe('holdBackIncompleteStoryBlock', () => {
	const chart = '<chart query_id="q1" chart_type="bar" x_axis_key="month" />';

	it.each([
		{
			name: 'a half-written chart',
			code: `# Sales\n\n<chart query_id="q1" series='[{"da`,
			visible: '# Sales\n\n',
			pending: 'chart',
		},
		{
			name: 'a chart with a quoted ">"',
			code: 'Intro\n<chart title="a > b" query_id="q',
			visible: 'Intro\n',
			pending: 'chart',
		},
		{ name: 'an open grid', code: `Intro\n<grid widths="1,1">\n${chart}\n`, visible: 'Intro\n', pending: 'grid' },
		{ name: 'a half-written filter', code: 'Intro\n<filter id="region" ty', visible: 'Intro\n', pending: null },
		{ name: 'a half-written tag name', code: 'Intro\n<cha', visible: 'Intro\n', pending: null },
	])('holds back $name', ({ code, visible, pending }) => {
		expect(holdBackIncompleteStoryBlock(code)).toEqual({ code: visible, pendingBlock: pending });
	});

	it.each([
		{ name: 'a complete chart', code: `# Sales\n\n${chart}` },
		{ name: 'a closed grid', code: `<grid widths="1,1">\n${chart}\n${chart}\n</grid>\n\nAfter` },
		{ name: 'plain text', code: '# Sales\n\nRevenue grew **12%' },
	])('keeps $name', ({ code }) => {
		expect(holdBackIncompleteStoryBlock(code)).toEqual({ code, pendingBlock: null });
	});
});

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

	it('ignores a story of another chat under the same slug', () => {
		const messages = [
			createStoryMessage({
				messageId: 'message-1',
				state: 'output-available',
				input: { id: 'sales', action: 'create', code: '# this chat' },
				output: { success: true, id: 'sales', title: 'Sales', code: '# this chat', version: 1 },
			}),
			createStoryMessage({
				messageId: 'message-2',
				state: 'output-available',
				input: { id: 'story-uuid', action: 'replace', code: '# another chat' },
				output: {
					success: true,
					id: 'sales',
					title: 'Other sales',
					code: '# another chat',
					version: 4,
					story_chat_id: 'another-chat',
					story_id: 'story-uuid',
				},
			}),
		];

		expect(findStoryDraft(messages, 'sales')?.code).toBe('# this chat');
	});

	it('finds a streaming edit of the viewed story from its id', () => {
		const messages = [
			createStoryMessage({
				messageId: 'message-1',
				state: 'input-streaming',
				input: { id: 'story-uuid', action: 'replace', code: '# editing' },
			}),
		];

		expect(findStoryDraft(messages, 'sales', 'story-uuid')).toMatchObject({ id: 'sales', code: '# editing' });
		expect(findStoryDraft(messages, 'sales', 'other-uuid')).toBeNull();
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
