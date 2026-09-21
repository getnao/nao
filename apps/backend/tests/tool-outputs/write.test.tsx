import React from 'react';
import { describe, expect, it } from 'vitest';

import { WriteOutput } from '../../src/components/tool-outputs';
import { renderToMarkdown } from '../../src/lib/markdown';
import { printOutput } from './print-output';

describe('WriteOutput', () => {
	it('confirms the saved path and size', () => {
		const result = renderToMarkdown(
			<WriteOutput output={{ _version: '1', path: '/home/reports/q1.csv', size: 2048 }} />,
		);
		printOutput('write', 'saved file', result);

		expect(result).toBe('Saved /home/reports/q1.csv (2.0 KB).');
	});

	it('handles an empty file', () => {
		const result = renderToMarkdown(<WriteOutput output={{ _version: '1', path: '/home/empty.txt', size: 0 }} />);
		printOutput('write', 'empty file', result);

		expect(result).toBe('Saved /home/empty.txt (0 B).');
	});
});
