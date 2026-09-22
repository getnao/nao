import { describe, expect, it } from 'vitest';

import { matchesOrderedTerms } from './path-search';

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
