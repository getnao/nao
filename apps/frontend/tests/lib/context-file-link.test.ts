import { describe, expect, it } from 'vitest';

import { formatCodeLines, parseContextFileLink } from '@/lib/context-file-link';

describe('parseContextFileLink', () => {
	it.each([
		{ path: 'docs/glossary.md', lines: '', expected: { path: '/docs/glossary.md', lines: null } },
		{ path: '/RULES.md', lines: '12', expected: { path: '/RULES.md', lines: { start: 12, end: 12 } } },
		{
			path: 'docs/glossary.md',
			lines: '4-8',
			expected: { path: '/docs/glossary.md', lines: { start: 4, end: 8 } },
		},
		{
			path: 'docs/glossary.md',
			lines: '8 – 4',
			expected: { path: '/docs/glossary.md', lines: { start: 4, end: 8 } },
		},
		{ path: 'docs/glossary.md', lines: '0', expected: { path: '/docs/glossary.md', lines: null } },
		{ path: 'docs/glossary.md', lines: 'L4', expected: { path: '/docs/glossary.md', lines: null } },
		{ path: '../secrets.md', lines: '', expected: null },
		{ path: '', lines: '4', expected: null },
	])('reads "$path" at lines "$lines"', ({ path, lines, expected }) => {
		expect(parseContextFileLink(path, lines)).toEqual(expected);
	});
});

describe('formatCodeLines', () => {
	it.each([
		{ lines: { start: 12, end: 12 }, expected: 'L12' },
		{ lines: { start: 4, end: 8 }, expected: 'L4–8' },
	])('writes $expected', ({ lines, expected }) => {
		expect(formatCodeLines(lines)).toBe(expected);
	});
});
