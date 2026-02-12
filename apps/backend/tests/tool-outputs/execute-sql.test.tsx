import React from 'react';
import { describe, expect, it } from 'vitest';

import { ExecuteSqlOutput } from '../../src/components/tool-outputs';
import { renderToMarkdown } from '../../src/lib/markdown';
import { printOutput } from './print-output';

describe('ExecuteSqlOutput', () => {
	it('renders rows with query ID, columns, and data', () => {
		const result = renderToMarkdown(
			<ExecuteSqlOutput
				output={{
					id: 'query_abc123',
					columns: ['id', 'name', 'email', 'created_at'],
					row_count: 3,
					data: [
						{ id: 1, name: 'Alice', email: 'alice@example.com', created_at: '2025-01-15T10:00:00Z' },
						{ id: 2, name: 'Bob', email: 'bob@example.com', created_at: '2025-02-20T14:30:00Z' },
						{
							id: 3,
							name: 'Charlie',
							email: 'charlie@example.com',
							created_at: '2025-03-10T09:15:00Z',
						},
					],
				}}
			/>,
		);
		printOutput('execute_sql', 'rows returned', result);

		expect(result).toBe(
			`Query ID: query_abc123

Columns (4):
- id
- name
- email
- created_at

## Rows (3)

\`\`\`#1
id: 1
name: Alice
email: alice@example.com
created_at: 2025-01-15T10:00:00Z
\`\`\`

\`\`\`#2
id: 2
name: Bob
email: bob@example.com
created_at: 2025-02-20T14:30:00Z
\`\`\`

\`\`\`#3
id: 3
name: Charlie
email: charlie@example.com
created_at: 2025-03-10T09:15:00Z
\`\`\``,
		);
	});

	it('renders empty result message when no rows', () => {
		const result = renderToMarkdown(
			<ExecuteSqlOutput
				output={{
					id: 'query_empty',
					columns: ['id'],
					row_count: 0,
					data: [],
				}}
			/>,
		);
		printOutput('execute_sql', 'no rows', result);

		expect(result).toBe('The query was successfully executed and returned no rows.');
	});

	it('truncates rows with maxRows', () => {
		const result = renderToMarkdown(
			<ExecuteSqlOutput
				maxRows={2}
				output={{
					id: 'query_1',
					columns: ['id', 'name'],
					row_count: 3,
					data: [
						{ id: 1, name: 'Alice' },
						{ id: 2, name: 'Bob' },
						{ id: 3, name: 'Charlie' },
					],
				}}
			/>,
		);
		printOutput('execute_sql', 'maxRows=2', result);

		expect(result).toBe(
			`Query ID: query_1

Columns (2):
- id
- name

## Rows (3)

\`\`\`#1
id: 1
name: Alice
\`\`\`

\`\`\`#2
id: 2
name: Bob
\`\`\`

...(1 more)`,
		);
	});
});
