import React from 'react';
import { describe, expect, it } from 'vitest';

import { ReadOutput } from '../../src/components/tool-outputs';
import { renderToMarkdown } from '../../src/lib/markdown';
import { printOutput } from './print-output';

describe('ReadOutput', () => {
	it('renders file content with line numbers', () => {
		const result = renderToMarkdown(
			<ReadOutput
				output={{
					_version: '2',
					content: [
						'import { useState } from "react";',
						'',
						'export function Counter() {',
						'  const [count, setCount] = useState(0);',
						'  return (',
						'    <button onClick={() => setCount(c => c + 1)}>',
						'      Count: {count}',
						'    </button>',
						'  );',
						'}',
					].join('\n'),
					startLine: 1,
					numberOfTotalLines: 10,
				}}
			/>,
		);
		printOutput('read', 'file with content', result);

		expect(result).toBe(
			`1:import { useState } from "react";
2:
3:export function Counter() {
4:  const [count, setCount] = useState(0);
5:  return (
6:    <button onClick={() => setCount(c => c + 1)}>
7:      Count: {count}
8:    </button>
9:  );
10:}`,
		);
	});

	it('renders empty file message', () => {
		const result = renderToMarkdown(
			<ReadOutput
				output={{
					_version: '2',
					content: '',
					startLine: 1,
					numberOfTotalLines: 0,
				}}
			/>,
		);
		printOutput('read', 'empty file', result);

		expect(result).toBe('File is empty.');
	});

	it('renders single-line file', () => {
		const result = renderToMarkdown(
			<ReadOutput output={{ _version: '2', content: 'hello world', startLine: 1, numberOfTotalLines: 1 }} />,
		);
		printOutput('read', 'single line', result);

		expect(result).toBe('1:hello world');
	});

	it('truncates content with maxChars', () => {
		const result = renderToMarkdown(
			<ReadOutput
				maxChars={10}
				output={{
					_version: '2',
					content: 'abcdefghijklmnop',
					startLine: 1,
					numberOfTotalLines: 1,
				}}
			/>,
		);
		printOutput('read', 'maxChars=10', result);

		expect(result).toBe('1:abcdefghij...(6 B left)');
	});

	it('renders v1 output without startLine', () => {
		const result = renderToMarkdown(
			<ReadOutput
				output={{
					_version: '1',
					content: 'hello world',
					numberOfTotalLines: 1,
				}}
			/>,
		);
		printOutput('read', 'v1 output', result);

		expect(result).toBe('1:hello world');
	});

	it('renders with startLine offset', () => {
		const result = renderToMarkdown(
			<ReadOutput
				output={{
					_version: '2',
					content: ['line five', 'line six', 'line seven'].join('\n'),
					startLine: 5,
					numberOfTotalLines: 10,
				}}
			/>,
		);
		printOutput('read', 'with startLine offset', result);

		expect(result).toBe('5:line five\n6:line six\n7:line seven');
	});
});
