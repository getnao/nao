import { describe, expect, it } from 'vitest';

import { formatFilterResultSummary, searchFilterOptions } from './story-filter-options';

describe('story filter options', () => {
	const options = ['Books', 'Electronics', 'Home & Garden', 'e-Books'];

	it('returns every option when the search is blank', () => {
		expect(searchFilterOptions(options, '')).toBe(options);
		expect(searchFilterOptions(options, '   ')).toBe(options);
	});

	it('matches options case-insensitively on any substring', () => {
		expect(searchFilterOptions(options, 'BOOK')).toEqual(['Books', 'e-Books']);
		expect(searchFilterOptions(options, ' garden ')).toEqual(['Home & Garden']);
		expect(searchFilterOptions(options, 'toys')).toEqual([]);
	});

	it.each([
		['', 50, 1200, 'Showing 50 of 1,200 options'],
		['', 3, 3, '3 options'],
		['', 1, 1, '1 option'],
		['cat', 50, 75, '75 matches for “cat” · showing 50'],
		['cat', 1, 1, '1 match for “cat”'],
	])('summarises search "%s" showing %i of %i', (search, shown, total, expected) => {
		expect(formatFilterResultSummary(search, shown, total)).toBe(expected);
	});
});
