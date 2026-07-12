import { describe, expect, it } from 'vitest';

import {
	type ColorScaleRule,
	computeColumnRange,
	DEFAULT_SCALE_MAX_COLOR,
	DEFAULT_SCALE_MIN_COLOR,
	resolveCellBackground,
	sanitizeConditionalFormats,
	type ThresholdRule,
} from '../src/conditional-formatting';

const rows = [{ amount: 0 }, { amount: 50 }, { amount: 100 }, { amount: null }, { amount: 'n/a' }];

describe('computeColumnRange', () => {
	it('ignores non-numeric and nullish values', () => {
		expect(computeColumnRange(rows, 'amount')).toEqual({ min: 0, max: 100 });
	});

	it('returns null when no numeric values exist', () => {
		expect(computeColumnRange([{ label: 'a' }], 'label')).toBeNull();
	});
});

describe('resolveCellBackground - color-scale', () => {
	const rule: ColorScaleRule = { type: 'color-scale' };
	const range = { min: 0, max: 100 };

	it('maps the minimum to the min color', () => {
		expect(resolveCellBackground(rule, 0, range)).toBe(rgbaFrom(DEFAULT_SCALE_MIN_COLOR));
	});

	it('maps the maximum to the max color', () => {
		expect(resolveCellBackground(rule, 100, range)).toBe(rgbaFrom(DEFAULT_SCALE_MAX_COLOR));
	});

	it('interpolates the midpoint between endpoints', () => {
		expect(resolveCellBackground(rule, 50, range)).toBe('rgba(59, 130, 246, 0.3)');
	});

	it('clamps values outside the domain', () => {
		expect(resolveCellBackground(rule, 200, range)).toBe(rgbaFrom(DEFAULT_SCALE_MAX_COLOR));
		expect(resolveCellBackground(rule, -50, range)).toBe(rgbaFrom(DEFAULT_SCALE_MIN_COLOR));
	});

	it('honours an explicit domain over the column range', () => {
		const explicit: ColorScaleRule = { type: 'color-scale', min: 0, max: 200 };
		expect(resolveCellBackground(explicit, 100, { min: 0, max: 100 })).toBe('rgba(59, 130, 246, 0.3)');
	});

	it('returns the max color when the range is degenerate', () => {
		expect(resolveCellBackground(rule, 5, { min: 5, max: 5 })).toBe(rgbaFrom(DEFAULT_SCALE_MAX_COLOR));
	});

	it('supports hex endpoint colors', () => {
		const hexRule: ColorScaleRule = { type: 'color-scale', minColor: '#000000', maxColor: '#ffffff' };
		expect(resolveCellBackground(hexRule, 50, range)).toBe('rgba(128, 128, 128, 1)');
	});

	it('ignores non-numeric cell values', () => {
		expect(resolveCellBackground(rule, 'text', range)).toBeUndefined();
		expect(resolveCellBackground(rule, null, range)).toBeUndefined();
	});
});

describe('resolveCellBackground - threshold', () => {
	const rule: ThresholdRule = { type: 'threshold', operator: '>=', value: 100, color: 'rgba(1, 2, 3, 0.5)' };

	it('applies the color when the comparison passes', () => {
		expect(resolveCellBackground(rule, 150, null)).toBe('rgba(1, 2, 3, 0.5)');
	});

	it('returns undefined when the comparison fails', () => {
		expect(resolveCellBackground(rule, 50, null)).toBeUndefined();
	});

	it('supports the strict less-than operator', () => {
		const lt: ThresholdRule = { type: 'threshold', operator: '<', value: 0, color: 'red' };
		expect(resolveCellBackground(lt, -1, null)).toBe('red');
		expect(resolveCellBackground(lt, 0, null)).toBeUndefined();
	});

	it('supports the strict greater-than operator', () => {
		const gt: ThresholdRule = { type: 'threshold', operator: '>', value: 10, color: 'red' };
		expect(resolveCellBackground(gt, 11, null)).toBe('red');
		expect(resolveCellBackground(gt, 10, null)).toBeUndefined();
	});

	it('supports the less-than-or-equal operator', () => {
		const lte: ThresholdRule = { type: 'threshold', operator: '<=', value: 10, color: 'red' };
		expect(resolveCellBackground(lte, 10, null)).toBe('red');
		expect(resolveCellBackground(lte, 11, null)).toBeUndefined();
	});

	it('supports the equals operator', () => {
		const eq: ThresholdRule = { type: 'threshold', operator: '=', value: 10, color: 'red' };
		expect(resolveCellBackground(eq, 10, null)).toBe('red');
		expect(resolveCellBackground(eq, 9, null)).toBeUndefined();
	});
});

describe('parseHexColor via color-scale endpoints', () => {
	const range = { min: 0, max: 100 };

	it('parses 8-digit #RRGGBBAA hex with alpha', () => {
		const rule: ColorScaleRule = { type: 'color-scale', minColor: '#00000080', maxColor: '#00000080' };
		expect(resolveCellBackground(rule, 50, range)).toBe('rgba(0, 0, 0, 0.5)');
	});

	it('parses 3-digit shorthand hex', () => {
		const rule: ColorScaleRule = { type: 'color-scale', minColor: '#fff', maxColor: '#fff' };
		expect(resolveCellBackground(rule, 50, range)).toBe('rgba(255, 255, 255, 1)');
	});

	it('yields no background for malformed hex endpoints', () => {
		const rule: ColorScaleRule = { type: 'color-scale', minColor: '#12xyz6', maxColor: '#123456' };
		expect(resolveCellBackground(rule, 50, range)).toBeUndefined();
	});
});

describe('sanitizeConditionalFormats', () => {
	it('keeps valid rules and drops malformed entries', () => {
		const input = {
			good: { type: 'color-scale' },
			badNull: null,
			badType: { type: 'formula' },
			badThreshold: { type: 'threshold', operator: '!!', value: 1, color: 'red' },
			goodThreshold: { type: 'threshold', operator: '>=', value: 1, color: 'red' },
		};
		expect(sanitizeConditionalFormats(input)).toEqual({
			good: { type: 'color-scale' },
			goodThreshold: { type: 'threshold', operator: '>=', value: 1, color: 'red' },
		});
	});

	it('returns undefined for non-object or fully-invalid input', () => {
		expect(sanitizeConditionalFormats(null)).toBeUndefined();
		expect(sanitizeConditionalFormats([{ type: 'color-scale' }])).toBeUndefined();
		expect(sanitizeConditionalFormats({ bad: { type: 'nope' } })).toBeUndefined();
	});

	it('rejects color-scale rules with a non-string color', () => {
		expect(sanitizeConditionalFormats({ bad: { type: 'color-scale', minColor: {} } })).toBeUndefined();
		expect(sanitizeConditionalFormats({ bad: { type: 'color-scale', maxColor: 5 } })).toBeUndefined();
	});

	it('rejects color-scale rules with a non-finite numeric bound', () => {
		expect(sanitizeConditionalFormats({ bad: { type: 'color-scale', min: 'low' } })).toBeUndefined();
		expect(sanitizeConditionalFormats({ bad: { type: 'color-scale', max: Number.NaN } })).toBeUndefined();
	});

	it('keeps a fully-specified valid color-scale rule', () => {
		const valid = { type: 'color-scale', minColor: '#000', maxColor: '#fff', min: 0, max: 100 };
		expect(sanitizeConditionalFormats({ ok: valid })).toEqual({ ok: valid });
	});
});

function rgbaFrom(color: string): string {
	const [r, g, b, a] = color
		.replace(/rgba?\(|\)/g, '')
		.split(',')
		.map((part) => Number.parseFloat(part.trim()));
	return `rgba(${r}, ${g}, ${b}, ${a})`;
}
