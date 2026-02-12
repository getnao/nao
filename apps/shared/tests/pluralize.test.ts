import { describe, expect, it } from 'vitest';

import { pluralize } from '../src/pluralize';

describe('pluralize', () => {
	it('returns singular when count is 1', () => {
		expect(pluralize('File', 1)).toBe('File');
		expect(pluralize('Directory', 1)).toBe('Directory');
	});

	describe('default rule (append s)', () => {
		it('appends s to regular words', () => {
			expect(pluralize('File', 2)).toBe('Files');
			expect(pluralize('Table', 5)).toBe('Tables');
			expect(pluralize('Column', 0)).toBe('Columns');
		});
	});

	describe('consonant + y rule (y -> ies)', () => {
		it('replaces y with ies', () => {
			expect(pluralize('Directory', 3)).toBe('Directories');
			expect(pluralize('Entry', 2)).toBe('Entries');
			expect(pluralize('Category', 10)).toBe('Categories');
		});

		it('does not apply when y is preceded by a vowel', () => {
			expect(pluralize('Key', 2)).toBe('Keys');
			expect(pluralize('Day', 3)).toBe('Days');
			expect(pluralize('Toy', 4)).toBe('Toys');
		});
	});

	describe('sibilant rule (s, sh, ch, x, z -> es)', () => {
		it('appends es to words ending in s', () => {
			expect(pluralize('Glass', 2)).toBe('Glasses');
			expect(pluralize('Bus', 3)).toBe('Buses');
		});

		it('appends es to words ending in sh', () => {
			expect(pluralize('Dash', 2)).toBe('Dashes');
		});

		it('appends es to words ending in ch', () => {
			expect(pluralize('Match', 2)).toBe('Matches');
			expect(pluralize('Branch', 4)).toBe('Branches');
		});

		it('appends es to words ending in x', () => {
			expect(pluralize('Index', 2)).toBe('Indexes');
			expect(pluralize('Box', 3)).toBe('Boxes');
		});

		it('appends es to words ending in z', () => {
			expect(pluralize('Quiz', 2)).toBe('Quizes');
		});
	});

	describe('f/fe rule (f/fe -> ves)', () => {
		it('replaces f with ves', () => {
			expect(pluralize('Leaf', 2)).toBe('Leaves');
			expect(pluralize('Shelf', 3)).toBe('Shelves');
		});

		it('replaces fe with ves', () => {
			expect(pluralize('Knife', 2)).toBe('Knives');
			expect(pluralize('Life', 3)).toBe('Lives');
		});
	});

	describe('case preservation', () => {
		it('preserves lowercase', () => {
			expect(pluralize('file', 2)).toBe('files');
			expect(pluralize('directory', 3)).toBe('directories');
			expect(pluralize('glass', 2)).toBe('glasses');
		});

		it('preserves uppercase ending', () => {
			expect(pluralize('FILE', 2)).toBe('FILES');
			expect(pluralize('DIRECTORY', 3)).toBe('DIRECTORIES');
			expect(pluralize('GLASS', 2)).toBe('GLASSES');
			expect(pluralize('MATCH', 2)).toBe('MATCHES');
		});
	});
});
