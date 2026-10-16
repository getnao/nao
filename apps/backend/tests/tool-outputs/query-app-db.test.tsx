import React from 'react';
import { describe, expect, it } from 'vitest';

import type { QueryAppDbResult } from '../../src/agents/tools/query-app-db';
import { QueryAppDbOutput } from '../../src/components/tool-outputs';
import { renderToMarkdown } from '../../src/lib/markdown';
import { printOutput } from './print-output';

function buildResult(rows: Record<string, unknown>[]): QueryAppDbResult {
	return { _version: '1', columns: Object.keys(rows[0] ?? {}), rows, rowCount: rows.length };
}

describe('QueryAppDbOutput', () => {
	it('renders columns and rows', () => {
		const result = renderToMarkdown(
			<QueryAppDbOutput
				output={buildResult([
					{ chat_id: 'chat-1', role: 'user' },
					{ chat_id: 'chat-1', role: 'assistant' },
				])}
			/>,
		);
		printOutput('query_app_db', 'rows returned', result);

		expect(result).toBe(
			`Columns (2):
- chat_id
- role

## Rows (2)

\`\`\`#1
chat_id: chat-1
role: user
\`\`\`

\`\`\`#2
chat_id: chat-1
role: assistant
\`\`\``,
		);
	});

	it('renders empty result message when no rows', () => {
		const result = renderToMarkdown(<QueryAppDbOutput output={buildResult([])} />);

		expect(result).toBe('The query was successfully executed and returned no rows.');
	});

	it('caps the number of rows', () => {
		const rows = Array.from({ length: 5 }, (_, index) => ({ id: index }));
		const result = renderToMarkdown(<QueryAppDbOutput output={buildResult(rows)} maxRows={2} />);

		expect(result).toContain('## Rows (5)');
		expect(result).toContain('#2');
		expect(result).not.toContain('#3');
		expect(result).toContain('3 more rows not shown');
	});

	it('truncates long values', () => {
		const result = renderToMarkdown(
			<QueryAppDbOutput output={buildResult([{ tool_output: 'x'.repeat(5_000) }])} maxValueLength={100} />,
		);

		expect(result).not.toContain('x'.repeat(101));
		expect(result).toContain('Values longer than 100 characters are truncated');
	});

	it('stops adding rows once the character budget is spent', () => {
		const rows = Array.from({ length: 50 }, () => ({ text: 'y'.repeat(900) }));
		const result = renderToMarkdown(<QueryAppDbOutput output={buildResult(rows)} maxRowsCharacters={2_000} />);

		expect(result).toContain('#2');
		expect(result).not.toContain('#3');
		expect(result).toContain('48 more rows not shown');
		expect(result.length).toBeLessThan(3_000);
	});

	it('always shows the first row even when it exceeds the budget', () => {
		const result = renderToMarkdown(
			<QueryAppDbOutput output={buildResult([{ text: 'z'.repeat(500) }])} maxRowsCharacters={10} />,
		);

		expect(result).toContain('#1');
		expect(result).not.toContain('more rows not shown');
	});
});
