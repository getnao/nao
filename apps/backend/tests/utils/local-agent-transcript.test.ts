import { describe, expect, it } from 'vitest';

import type { UIMessage } from '../../src/types/chat';
import { renderLocalAgentHistory } from '../../src/utils/local-agent-transcript';

describe('renderLocalAgentHistory', () => {
	it('replays the text and tool calls of earlier messages, without the reasoning', () => {
		const messages = [
			{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'How many orders?' }] },
			{
				id: 'm2',
				role: 'assistant',
				parts: [
					{ type: 'reasoning', text: 'secret thoughts' },
					{
						type: 'tool-execute_sql',
						toolCallId: 'call-1',
						state: 'output-available',
						input: { sql_query: 'select count(*) from orders' },
						output: { data: [{ count: 42 }] },
					},
					{ type: 'text', text: 'There are 42 orders.' },
				],
			},
		] as UIMessage[];

		expect(renderLocalAgentHistory(messages)).toBe(
			[
				'<user>\nHow many orders?\n</user>',
				'<assistant>\n[tool execute_sql] input: {"sql_query":"select count(*) from orders"}\noutput: {"data":[{"count":42}]}\nThere are 42 orders.\n</assistant>',
			].join('\n\n'),
		);
	});

	it('has no history for a new chat', () => {
		expect(renderLocalAgentHistory([])).toBeNull();
	});
});
