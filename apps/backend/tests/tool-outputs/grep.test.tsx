import React from 'react';
import { describe, expect, it } from 'vitest';

import { GrepOutput } from '../../src/components/tool-outputs';
import { renderToMarkdown } from '../../src/lib/markdown';
import { printOutput } from './print-output';

describe('GrepOutput', () => {
	it('renders matches grouped by file', () => {
		const result = renderToMarkdown(
			<GrepOutput
				output={{
					matches: [
						{
							path: 'src/services/auth.ts',
							line_number: 12,
							line_content: 'export async function authenticate(token: string) {',
						},
						{
							path: 'src/services/auth.ts',
							line_number: 45,
							line_content: '  if (!isValid) throw new AuthError("Invalid token");',
						},
						{
							path: 'src/middleware/auth.ts',
							line_number: 8,
							line_content: 'import { authenticate } from "../services/auth";',
						},
						{
							path: 'src/middleware/auth.ts',
							line_number: 22,
							line_content: '  const user = await authenticate(req.headers.authorization);',
						},
						{
							path: 'src/routes/login.ts',
							line_number: 31,
							line_content: '  const session = await authenticate(credentials);',
						},
					],
					total_matches: 5,
					truncated: false,
				}}
			/>,
		);
		printOutput('grep', 'matches found', result);

		expect(result).toBe(
			`Matches (5)

\`\`\`src/services/auth.ts (2)
12:export async function authenticate(token: string) {
45:  if (!isValid) throw new AuthError("Invalid token");
\`\`\`

\`\`\`src/middleware/auth.ts (2)
8:import { authenticate } from "../services/auth";
22:  const user = await authenticate(req.headers.authorization);
\`\`\`

\`\`\`src/routes/login.ts (1)
31:  const session = await authenticate(credentials);
\`\`\``,
		);
	});

	it('renders no matches message', () => {
		const result = renderToMarkdown(
			<GrepOutput
				output={{
					matches: [],
					total_matches: 0,
					truncated: false,
				}}
			/>,
		);
		printOutput('grep', 'no matches', result);

		expect(result).toBe('No matches found.');
	});

	it('truncates with maxLines and shows remaining files', () => {
		const result = renderToMarkdown(
			<GrepOutput
				maxLines={2}
				output={{
					matches: [
						{ path: 'a.ts', line_number: 1, line_content: 'first' },
						{ path: 'a.ts', line_number: 2, line_content: 'second' },
						{ path: 'b.ts', line_number: 1, line_content: 'third' },
					],
					total_matches: 3,
					truncated: true,
				}}
			/>,
		);
		printOutput('grep', 'maxLines=2', result);

		expect(result).toBe(
			`Matches (3)

\`\`\`a.ts (2)
1:first
2:second
\`\`\`

More matches in:
- b.ts`,
		);
	});

	it('truncates overflow files with maxMoreFiles', () => {
		const result = renderToMarkdown(
			<GrepOutput
				maxLines={2}
				maxMoreFiles={1}
				output={{
					matches: [
						{ path: 'a.ts', line_number: 1, line_content: 'first' },
						{ path: 'a.ts', line_number: 2, line_content: 'second' },
						{ path: 'b.ts', line_number: 1, line_content: 'third' },
						{ path: 'c.ts', line_number: 1, line_content: 'fourth' },
					],
					total_matches: 4,
					truncated: true,
				}}
			/>,
		);
		printOutput('grep', 'maxLines=2, maxMoreFiles=1', result);

		expect(result).toBe(
			`Matches (4)

\`\`\`a.ts (2)
1:first
2:second
\`\`\`

More matches in:
- b.ts
...(1 more)`,
		);
	});
});
