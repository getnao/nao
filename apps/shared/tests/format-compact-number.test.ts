import { describe, expect, it } from 'vitest';

import { formatCompactNumber } from '../src/chart-builder';

describe('formatCompactNumber', () => {
	describe('billions', () => {
		it('formats 1B exactly', () => expect(formatCompactNumber(1_000_000_000)).toBe('1B'));
		it('formats 1.2B', () => expect(formatCompactNumber(1_234_567_890)).toBe('1.2B'));
		it('formats negative billions', () => expect(formatCompactNumber(-2_500_000_000)).toBe('-2.5B'));
	});

	describe('millions', () => {
		it('formats 1M exactly', () => expect(formatCompactNumber(1_000_000)).toBe('1M'));
		it('formats 12.3M', () => expect(formatCompactNumber(12_345_678)).toBe('12.3M'));
		it('formats 1.5M', () => expect(formatCompactNumber(1_500_000)).toBe('1.5M'));
		it('formats negative millions', () => expect(formatCompactNumber(-3_200_000)).toBe('-3.2M'));
	});

	describe('thousands (>=10K threshold)', () => {
		it('formats 45K', () => expect(formatCompactNumber(45_000)).toBe('45K'));
		it('formats 10K boundary', () => expect(formatCompactNumber(10_000)).toBe('10K'));
		it('formats 99.9K', () => expect(formatCompactNumber(99_900)).toBe('99.9K'));
	});

	describe('below threshold (comma-separated)', () => {
		it('keeps 999 as-is', () => expect(formatCompactNumber(999)).toBe('999'));
		it('keeps 9999 as-is', () => expect(formatCompactNumber(9_999)).toBe('9,999'));
		it('keeps 0 as-is', () => expect(formatCompactNumber(0)).toBe('0'));
	});

	describe('trailing zero removal', () => {
		it('removes .0 suffix: 2B not 2.0B', () => expect(formatCompactNumber(2_000_000_000)).toBe('2B'));
		it('removes .0 suffix: 5M not 5.0M', () => expect(formatCompactNumber(5_000_000)).toBe('5M'));
		it('removes .0 suffix: 20K not 20.0K', () => expect(formatCompactNumber(20_000)).toBe('20K'));
	});
});
