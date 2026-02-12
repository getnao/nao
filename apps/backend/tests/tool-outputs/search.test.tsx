import React from 'react';
import { describe, expect, it } from 'vitest';

import { SearchOutput } from '../../src/components/tool-outputs';
import { renderToMarkdown } from '../../src/lib/markdown';
import { printOutput } from './print-output';

describe('SearchOutput', () => {
	it('renders matching files with sizes', () => {
		const result = renderToMarkdown(
			<SearchOutput
				output={{
					_version: '1',
					files: [
						{ path: 'src/components/button.tsx', dir: 'src/components', size: '2048' },
						{ path: 'src/components/input.tsx', dir: 'src/components', size: '1536' },
						{ path: 'src/components/modal.tsx', dir: 'src/components', size: '4096' },
						{ path: 'src/components/tooltip.tsx', dir: 'src/components', size: '890' },
						{ path: 'src/hooks/use-modal.ts', dir: 'src/hooks', size: '640' },
						{ path: 'tests/components/button.test.tsx', dir: 'tests/components', size: '3200' },
					],
				}}
			/>,
		);
		printOutput('search', 'files found', result);

		expect(result).toBe(
			`Matches (6):
- src/components/button.tsx (2.0 KB)
- src/components/input.tsx (1.5 KB)
- src/components/modal.tsx (4.0 KB)
- src/components/tooltip.tsx (890 B)
- src/hooks/use-modal.ts (640 B)
- tests/components/button.test.tsx (3.1 KB)`,
		);
	});

	it('renders no matches message', () => {
		const result = renderToMarkdown(
			<SearchOutput
				output={{
					_version: '1',
					files: [],
				}}
			/>,
		);
		printOutput('search', 'no matches', result);

		expect(result).toBe('No matches.');
	});

	it('truncates files with maxFiles', () => {
		const result = renderToMarkdown(
			<SearchOutput
				maxFiles={2}
				output={{
					_version: '1',
					files: [
						{ path: 'a.ts', dir: 'src', size: '100' },
						{ path: 'b.ts', dir: 'src', size: '200' },
						{ path: 'c.ts', dir: 'lib', size: '300' },
					],
				}}
			/>,
		);
		printOutput('search', 'maxFiles=2', result);

		expect(result).toBe(
			`Matches (3):
- a.ts (100 B)
- b.ts (200 B)
...(1 more)

More matches in:
- lib`,
		);
	});

	it('truncates directories with maxDirectories', () => {
		const result = renderToMarkdown(
			<SearchOutput
				maxFiles={1}
				maxDirectories={1}
				output={{
					_version: '1',
					files: [
						{ path: 'a/x.ts', dir: 'a', size: '100' },
						{ path: 'b/y.ts', dir: 'b', size: '200' },
						{ path: 'c/z.ts', dir: 'c', size: '300' },
					],
				}}
			/>,
		);
		printOutput('search', 'maxFiles=1, maxDirectories=1', result);

		expect(result).toBe(
			`Matches (3):
- a/x.ts (100 B)
...(2 more)

More matches in:
- b
...(1 more)`,
		);
	});
});
