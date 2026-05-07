import React from 'react';
import { describe, expect, it } from 'vitest';

import { ReadQueryResultOutput } from '../../src/components/tool-outputs';
import { renderToMarkdown } from '../../src/lib/markdown';
import { printOutput } from './print-output';

describe('ReadQueryResultOutput', () => {
	it('renders a slice in the middle of the result with a hint pointing to the next page', () => {
		const result = renderToMarkdown(
			<ReadQueryResultOutput
				output={{
					id: 'query_abc123',
					columns: ['id', 'name'],
					row_count: 50,
					offset: 20,
					limit: 2,
					data: [
						{ id: 21, name: 'Twenty-one' },
						{ id: 22, name: 'Twenty-two' },
					],
				}}
			/>,
		);
		printOutput('read_query_result', 'middle slice', result);

		expect(result).toBe(
			`Query ID: query_abc123

Columns (2):
- id
- name

## Rows 21–22 of 50

\`\`\`#21
id: 21
name: Twenty-one
\`\`\`

\`\`\`#22
id: 22
name: Twenty-two
\`\`\`

...(28 more — call read_query_result again with offset 22 to see more)`,
		);
	});

	it('omits the "see more" hint when the slice reaches the end', () => {
		const result = renderToMarkdown(
			<ReadQueryResultOutput
				output={{
					id: 'query_end',
					columns: ['id'],
					row_count: 3,
					offset: 1,
					limit: 10,
					data: [{ id: 2 }, { id: 3 }],
				}}
			/>,
		);
		printOutput('read_query_result', 'tail slice', result);

		expect(result).toBe(
			`Query ID: query_end

Column (1):
- id

## Rows 2–3 of 3

\`\`\`#2
id: 2
\`\`\`

\`\`\`#3
id: 3
\`\`\``,
		);
	});

	it('reports an empty slice when the offset is past the end', () => {
		const result = renderToMarkdown(
			<ReadQueryResultOutput
				output={{
					id: 'query_past',
					columns: ['id'],
					row_count: 2,
					offset: 5,
					limit: 10,
					data: [],
				}}
			/>,
		);
		printOutput('read_query_result', 'offset past end', result);

		expect(result).toBe(`Query ID: query_past

Offset 5 is past the end of the result (2 total rows).`);
	});

	it('reports when the underlying query had no rows', () => {
		const result = renderToMarkdown(
			<ReadQueryResultOutput
				output={{
					id: 'query_empty',
					columns: ['id'],
					row_count: 0,
					offset: 0,
					limit: 10,
					data: [],
				}}
			/>,
		);
		printOutput('read_query_result', 'empty result', result);

		expect(result).toBe('The query result for query_empty contains no rows.');
	});
});
