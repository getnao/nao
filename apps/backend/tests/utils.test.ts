import { describe, expect, it } from 'vitest';

import { truncateMiddle } from '../src/utils/utils';

describe('truncateMiddle', () => {
	it('returns the string unchanged when shorter than maxLength', () => {
		expect(truncateMiddle('hello', 10)).toBe('hello');
	});

	it('truncates the middle of a long string', () => {
		expect(truncateMiddle('abcdefghij', 7)).toBe('ab...ij');
	});

	it('slices without ellipsis when maxLength <= ellipsis length', () => {
		expect(truncateMiddle('abcdef', 3)).toBe('abc');
	});

	it('uses a custom ellipsis string', () => {
		expect(truncateMiddle('abcdefghij', 8, '--')).toBe('abc--hij');
	});
});
