import { describe, expect, it } from 'vitest';

import { formatYAxisTick } from '../src/chart-builder';

describe('formatYAxisTick', () => {
	describe('positive abbreviation', () => {
		it('abbreviates thousands', () => expect(formatYAxisTick(1_234)).toBe('1.2K'));
		it('abbreviates millions', () => expect(formatYAxisTick(1_500_000)).toBe('1.5M'));
		it('abbreviates billions', () => expect(formatYAxisTick(2_000_000_000)).toBe('2B'));
		it('removes trailing .0', () => expect(formatYAxisTick(12_000)).toBe('12K'));
		it('keeps small integers as-is', () => expect(formatYAxisTick(500)).toBe('500'));
		it('keeps zero as-is', () => expect(formatYAxisTick(0)).toBe('0'));
	});

	describe('negative abbreviation (by absolute value, sign preserved)', () => {
		it('abbreviates negative thousands', () => expect(formatYAxisTick(-1234)).toBe('-1.2K'));
		it('abbreviates negative millions', () => expect(formatYAxisTick(-1_500_000)).toBe('-1.5M'));
		it('abbreviates negative billions', () => expect(formatYAxisTick(-2_500_000_000)).toBe('-2.5B'));
		it('keeps small negative integers as-is', () => expect(formatYAxisTick(-42)).toBe('-42'));
	});

	describe('fractional values capped to short output', () => {
		it('caps a long fractional value to two decimals', () => expect(formatYAxisTick(12.3456)).toBe('12.35'));
		it('caps a negative fractional value', () => expect(formatYAxisTick(-3.14159)).toBe('-3.14'));
		it('keeps a short fractional value', () => expect(formatYAxisTick(0.5)).toBe('0.5'));
		it('abbreviates fractional thousands', () => expect(formatYAxisTick(1234.5678)).toBe('1.2K'));
	});
});
