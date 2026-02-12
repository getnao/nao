import React from 'react';
import { describe, expect, it } from 'vitest';

import { ListOutput } from '../../src/components/tool-outputs';
import { renderToMarkdown } from '../../src/lib/markdown';
import { printOutput } from './print-output';

describe('ListOutput', () => {
	it('renders files, directories, and symbolic links', () => {
		const result = renderToMarkdown(
			<ListOutput
				output={{
					_version: '1',
					entries: [
						{ path: 'src/index.ts', name: 'index.ts', type: 'file', size: '1240' },
						{ path: 'src/utils.ts', name: 'utils.ts', type: 'file', size: '3891' },
						{ path: 'src/README.md', name: 'README.md', type: 'file', size: '512' },
						{ path: 'src/components', name: 'components', type: 'directory', itemCount: 14 },
						{ path: 'src/hooks', name: 'hooks', type: 'directory', itemCount: 7 },
						{ path: 'src/services', name: 'services', type: 'directory', itemCount: 5 },
						{ path: 'src/node_modules', name: 'node_modules', type: 'symbolic_link' },
					],
				}}
			/>,
		);
		printOutput('list', 'mixed entries', result);

		expect(result).toBe(
			`Files (3)
- index.ts (1.2 KB)
- utils.ts (3.8 KB)
- README.md (512 B)

Directories (3)
- components (14 items)
- hooks (7 items)
- services (5 items)

Symbolic Link (1)
- node_modules`,
		);
	});

	it('renders empty directory message', () => {
		const result = renderToMarkdown(
			<ListOutput
				output={{
					_version: '1',
					entries: [],
				}}
			/>,
		);
		printOutput('list', 'empty directory', result);

		expect(result).toBe('Directory is empty.');
	});

	it('renders files only', () => {
		const result = renderToMarkdown(
			<ListOutput
				output={{
					_version: '1',
					entries: [{ path: 'src/main.ts', name: 'main.ts', type: 'file', size: '256' }],
				}}
			/>,
		);
		printOutput('list', 'files only', result);

		expect(result).toBe(
			`File (1)
- main.ts (256 B)`,
		);
	});

	it('renders directories only', () => {
		const result = renderToMarkdown(
			<ListOutput
				output={{
					_version: '1',
					entries: [
						{ path: 'src/lib', name: 'lib', type: 'directory', itemCount: 3 },
						{ path: 'src/utils', name: 'utils', type: 'directory' },
					],
				}}
			/>,
		);
		printOutput('list', 'directories only', result);

		expect(result).toBe(
			`Directories (2)
- lib (3 items)
- utils`,
		);
	});
});
