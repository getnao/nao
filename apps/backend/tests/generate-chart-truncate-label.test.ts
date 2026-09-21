import { describe, expect, it } from 'vitest';

import { truncateLabel } from '../src/utils/generate-chart';

const hasLoneSurrogate = (value: string) =>
	/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);

describe('truncateLabel', () => {
	it('returns short labels unchanged', () => {
		expect(truncateLabel('Completed', 20)).toBe('Completed');
	});

	it('truncates long ASCII labels with an ellipsis', () => {
		expect(truncateLabel('abcdefghij', 5)).toBe('abcd…');
	});

	it('measures length by code points, not UTF-16 units', () => {
		// Three emoji = 3 code points but 6 UTF-16 units; must not over-truncate.
		expect(truncateLabel('😀😀😀', 5)).toBe('😀😀😀');
	});

	it('never splits a surrogate pair at the truncation boundary', () => {
		const result = truncateLabel('😀😀😀', 2);
		expect(result).toBe('😀…');
		expect(hasLoneSurrogate(result)).toBe(false);
		expect(result).not.toContain('�');
	});

	it('handles CJK extension characters (astral plane) cleanly', () => {
		const result = truncateLabel('𠀀𠀁𠀂𠀃', 3);
		expect(result).toBe('𠀀𠀁…');
		expect(hasLoneSurrogate(result)).toBe(false);
	});

	it('returns just an ellipsis when there is no room for content', () => {
		expect(truncateLabel('😀😀😀', 1)).toBe('…');
	});
});
