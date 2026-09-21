import { describe, expect, it } from 'vitest';

import { createIncrementalMarkdownBlockSplitter, updateIncrementalMarkdownBlocks } from './incremental-markdown-blocks';

describe('incremental markdown blocks', () => {
	it('seals plain paragraphs at blank lines', () => {
		const blocks = split('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.');

		expect(blocks).toEqual(['First paragraph.\n\n', 'Second paragraph.\n\n', 'Third paragraph.']);
	});

	it('never splits blank lines inside fenced code blocks', () => {
		const codeBlock = '```ts\nconst first = 1;\n\nconst second = 2;\n```\n\n';
		const blocks = split(`${codeBlock}After the code.`);

		expect(blocks).toEqual([codeBlock, 'After the code.']);
	});

	it('keeps an open fenced code block entirely in the tail', () => {
		const text = '~~~python\nprint("before")\n\nprint("after")';
		const result = updateIncrementalMarkdownBlocks(createIncrementalMarkdownBlockSplitter(), text);

		expect(result.sealedBlocks).toEqual([]);
		expect(result.tail).toBe(text);
	});

	it('keeps table headers, delimiters, and rows together', () => {
		const table = '| Name | Value |\n| --- | ---: |\n| Alpha | 1 |\n| Beta | 2 |\n\n';
		const blocks = split(`${table}After the table.`);

		expect(blocks).toEqual([table, 'After the table.']);
	});

	it('keeps nested and multi-paragraph lists together', () => {
		const list = [
			'- First item',
			'',
			'  Extra detail for the first item.',
			'',
			'  - Nested item',
			'    1. Nested ordered item',
			'',
			'- Second item',
			'',
		].join('\n');
		const blocks = split(`${list}\nAfter the list.`);

		expect(blocks).toEqual([`${list}\n`, 'After the list.']);
	});

	it('does not split multiline block math', () => {
		const math = '$$\n\\begin{aligned}\na &= 1 \\\\\n\nb &= 2\n\\end{aligned}\n$$\n\n';
		const blocks = split(`${math}After the equation.`);

		expect(blocks).toEqual([math, 'After the equation.']);
	});

	it('produces the same blocks for whole and chunked input', () => {
		const documents = [
			[
				'# Quarterly summary',
				'',
				'Revenue increased in every region.',
				'',
				'| Region | Revenue |',
				'| --- | ---: |',
				'| Europe | 120 |',
				'| Americas | 95 |',
				'',
				'Final note.',
			].join('\n'),
			[
				'Plan:',
				'',
				'- Prepare the dataset',
				'',
				'  Include late-arriving records.',
				'  - Validate identifiers',
				'',
				'- Publish the report',
				'',
				'Done.',
			].join('\n'),
			[
				'Before.',
				'',
				'```sql',
				'select *',
				'',
				'from orders;',
				'```',
				'',
				'$$',
				'x = y + 1',
				'',
				'z = x^2',
				'$$',
				'',
				'After.',
			].join('\n'),
		];

		for (const document of documents) {
			const expected = split(document);
			for (const chunkSize of [1, 2, 7, 31]) {
				expect(splitInChunks(document, chunkSize)).toEqual(expected);
			}
		}
	});

	it('resets when the incoming text is not an append', () => {
		const splitter = createIncrementalMarkdownBlockSplitter();
		updateIncrementalMarkdownBlocks(splitter, 'Original first.\n\nOriginal second.');

		const replacement = 'Replacement first.\n\nReplacement second.';
		const result = updateIncrementalMarkdownBlocks(splitter, replacement);

		expect([...result.sealedBlocks, result.tail]).toEqual(['Replacement first.\n\n', 'Replacement second.']);
		expect(splitter.consumedOffset).toBe(replacement.length);
	});
});

function split(text: string): string[] {
	const result = updateIncrementalMarkdownBlocks(createIncrementalMarkdownBlockSplitter(), text);
	return [...result.sealedBlocks, result.tail].filter(Boolean);
}

function splitInChunks(text: string, chunkSize: number): string[] {
	const splitter = createIncrementalMarkdownBlockSplitter();
	let result = updateIncrementalMarkdownBlocks(splitter, '');

	for (let offset = chunkSize; offset < text.length; offset += chunkSize) {
		result = updateIncrementalMarkdownBlocks(splitter, text.slice(0, offset));
	}
	result = updateIncrementalMarkdownBlocks(splitter, text);

	return [...result.sealedBlocks, result.tail].filter(Boolean);
}
