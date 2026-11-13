import { describe, expect, it } from 'vitest';

import { getMarkdownLayout, writeMarkdownBlocks } from '@/lib/markdown-blocks';

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
