import { describe, expect, it } from 'vitest';

import { findMarkdownLinesTargets, getMarkdownLayout, writeMarkdownBlocks } from '@/lib/markdown-blocks';

const TOKENS = [
	{ type: 'space', raw: '\n' },
	{ type: 'heading', raw: '# Title\n' },
	{ type: 'paragraph', raw: 'First   paragraph' },
	{ type: 'space', raw: '\n\n\n' },
	{ type: 'list', raw: '* item' },
];
const SOURCE = TOKENS.map((token) => token.raw).join('');
const CANONICALS = ['# Title', 'First paragraph', '- item'];

describe('writeMarkdownBlocks', () => {
	it.each([
		{ case: 'gives back the source as written when nothing changed', edited: CANONICALS, expected: SOURCE },
		{
			case: 'rewrites an edited block alone',
			edited: ['# Title', 'Second paragraph', '- item'],
			expected: '\n# Title\n\nSecond paragraph\n\n* item',
		},
		{
			case: 'joins the neighbors of a removed block with a blank line',
			edited: ['# Title', '- item'],
			expected: '\n# Title\n\n* item',
		},
		{
			case: 'keeps the text of blocks moved around',
			edited: ['- item', '# Title', 'First paragraph'],
			expected: '* item\n\n# Title\nFirst   paragraph',
		},
		{ case: 'skips empty blocks', edited: ['# Title', '', 'First paragraph', '- item'], expected: SOURCE },
		{ case: 'writes nothing for an empty file', edited: [''], expected: '' },
	])('$case', ({ edited, expected }) => {
		expect(writeMarkdownBlocks(getMarkdownLayout(TOKENS), CANONICALS, edited)).toBe(expected);
	});
});

describe('findMarkdownLinesTargets', () => {
	const DOCUMENT = [
		'# Orders',
		'',
		'Every order placed.',
		'',
		'| Column | Meaning |',
		'|--------|---------|',
		'| id | The order |',
		'| amount | Its total |',
		'',
		'- placed',
		'  still placed',
		'- shipped',
		'',
		'',
		'```sql',
		'select 1',
		'```',
	].join('\n');

	it.each([
		{ case: 'a heading', lines: { start: 1, end: 1 }, expected: [{ blockIndex: 0, rows: null }] },
		{ case: 'a blank line', lines: { start: 2, end: 2 }, expected: [] },
		{
			case: 'the blocks a range crosses',
			lines: { start: 1, end: 3 },
			expected: [
				{ blockIndex: 0, rows: null },
				{ blockIndex: 1, rows: null },
			],
		},
		{ case: 'a table header', lines: { start: 5, end: 6 }, expected: [{ blockIndex: 2, rows: [0] }] },
		{ case: 'table rows', lines: { start: 7, end: 8 }, expected: [{ blockIndex: 2, rows: [1, 2] }] },
		{
			case: 'a list item on its second line',
			lines: { start: 11, end: 11 },
			expected: [{ blockIndex: 3, rows: [0] }],
		},
		{ case: 'a list item', lines: { start: 12, end: 12 }, expected: [{ blockIndex: 3, rows: [1] }] },
		{
			case: 'a code block after blank lines',
			lines: { start: 16, end: 16 },
			expected: [{ blockIndex: 4, rows: null }],
		},
		{ case: 'lines past the end', lines: { start: 40, end: 45 }, expected: [] },
	])('finds $case', ({ lines, expected }) => {
		expect(findMarkdownLinesTargets(DOCUMENT, lines)).toEqual(expected);
	});
});
