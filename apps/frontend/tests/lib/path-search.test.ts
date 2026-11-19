import { describe, expect, it } from 'vitest';

import { matchesOrderedTerms, rankPathsByQuery } from '@/lib/path-search';

describe('matchesOrderedTerms', () => {
	it('matches terms in order', () => {
		expect(matchesOrderedTerms('src/foo/bar.ts', ['foo', 'bar'])).toBe(true);
	});

	it('does not match terms in the wrong order', () => {
		expect(matchesOrderedTerms('src/bar/foo.ts', ['foo', 'bar'])).toBe(false);
	});

	it('matches a single term as a substring', () => {
		expect(matchesOrderedTerms('src/foobar.ts', ['bar'])).toBe(true);
	});

	it('matches every path when terms are empty', () => {
		expect(matchesOrderedTerms('src/foo/bar.ts', [])).toBe(true);
	});

	it('matches mixed-case paths case-insensitively', () => {
		expect(matchesOrderedTerms('SRC/Foo/BAR.ts', ['foo', 'bar'])).toBe(true);
	});

	it('does not reuse overlapping characters between terms', () => {
		expect(matchesOrderedTerms('abc', ['ab', 'bc'])).toBe(false);
	});

	it('matches repeated terms only when each occurrence exists', () => {
		expect(matchesOrderedTerms('banana', ['a', 'a'])).toBe(true);
		expect(matchesOrderedTerms('bar', ['a', 'a'])).toBe(false);
	});
});

describe('rankPathsByQuery', () => {
	const paths = [
		'/databases/schema=sales/table=orders/columns.md',
		'/docs/orders-overview.md',
		'/docs/team/order-process.md',
		'/RULES.md',
	];

	it.each([
		{ query: '', expected: paths },
		{
			query: 'orders',
			expected: [
				'/docs/orders-overview.md',
				'/databases/schema=sales/table=orders/columns.md',
				'/docs/team/order-process.md',
			],
		},
		{ query: 'rules', expected: ['/RULES.md'] },
		{ query: 'ordprc', expected: ['/docs/team/order-process.md'] },
		{ query: 'columns sales', expected: ['/databases/schema=sales/table=orders/columns.md'] },
		{ query: 'sales columns', expected: ['/databases/schema=sales/table=orders/columns.md'] },
		{ query: 'invoices', expected: [] },
	])('ranks the paths matching "$query"', ({ query, expected }) => {
		expect(rankPathsByQuery(paths, query)).toEqual(expected);
	});

	it('ranks a file name starting with the query above one only containing it', () => {
		expect(rankPathsByQuery(['/a/my-order.md', '/a/order.md'], 'order')).toEqual(['/a/order.md', '/a/my-order.md']);
	});

	it('ranks shorter paths first among equal matches', () => {
		expect(rankPathsByQuery(['/deep/folder/notes.md', '/notes.md'], 'notes')).toEqual([
			'/notes.md',
			'/deep/folder/notes.md',
		]);
	});
});
