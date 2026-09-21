import { describe, expect, it } from 'vitest';

import {
	type BooleanRule,
	type ColorScaleRule,
	colorToHex,
	computeColumnRange,
	DEFAULT_SCALE_MAX_COLOR,
	DEFAULT_SCALE_MIN_COLOR,
	resolveCellBackground,
	sanitizeConditionalFormats,
	type StringRule,
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

describe('resolveCellBackground - color-scale from a main color', () => {
	const range = { min: 0, max: 100 };

	it('derives a light-tint → color gradient from the main color', () => {
		const rule: ColorScaleRule = { type: 'color-scale', color: '#ff0000' };
		expect(resolveCellBackground(rule, 0, range)).toBe('rgba(255, 0, 0, 0.04)');
		expect(resolveCellBackground(rule, 100, range)).toBe('rgba(255, 0, 0, 0.55)');
		expect(resolveCellBackground(rule, 50, range)).toBe('rgba(255, 0, 0, 0.3)');
	});

	it('accepts an rgb main color', () => {
		const rule: ColorScaleRule = { type: 'color-scale', color: 'rgb(0, 128, 0)' };
		expect(resolveCellBackground(rule, 100, range)).toBe('rgba(0, 128, 0, 0.55)');
	});

	it('lets explicit min/max colors override the main color', () => {
		const rule: ColorScaleRule = {
			type: 'color-scale',
			color: '#ff0000',
			minColor: '#000000',
			maxColor: '#ffffff',
		};
		expect(resolveCellBackground(rule, 50, range)).toBe('rgba(128, 128, 128, 1)');
	});

	it('falls back to the default scale when the main color is unparseable', () => {
		const rule: ColorScaleRule = { type: 'color-scale', color: 'not-a-color' };
		expect(resolveCellBackground(rule, 100, range)).toBe(rgbaFrom(DEFAULT_SCALE_MAX_COLOR));
	});

	it('derives the low end from color when only maxColor is explicit', () => {
		const rule: ColorScaleRule = { type: 'color-scale', color: '#ff0000', maxColor: '#00ff00' };
		// Low end derived from the main color (not the default blue), high end explicit.
		expect(resolveCellBackground(rule, 0, range)).toBe('rgba(255, 0, 0, 0.04)');
		expect(resolveCellBackground(rule, 100, range)).toBe('rgba(0, 255, 0, 1)');
	});

	it('derives the high end from color when only minColor is explicit', () => {
		const rule: ColorScaleRule = { type: 'color-scale', color: '#ff0000', minColor: '#0000ff' };
		expect(resolveCellBackground(rule, 0, range)).toBe('rgba(0, 0, 255, 1)');
		expect(resolveCellBackground(rule, 100, range)).toBe('rgba(255, 0, 0, 0.55)');
	});

	it('accepts an hsl main color', () => {
		const rule: ColorScaleRule = { type: 'color-scale', color: 'hsl(0, 100%, 50%)' };
		expect(resolveCellBackground(rule, 100, range)).toBe('rgba(255, 0, 0, 0.55)');
	});

	it('accepts an hsla main color', () => {
		const rule: ColorScaleRule = { type: 'color-scale', color: 'hsla(120, 100%, 25%, 1)' };
		expect(resolveCellBackground(rule, 100, range)).toBe('rgba(0, 128, 0, 0.55)');
	});

	it('clamps out-of-range HSL saturation/lightness to valid CSS', () => {
		// hsl(0, 200%, 50%) clamps saturation to 100% → pure red.
		const rule: ColorScaleRule = { type: 'color-scale', color: 'hsl(0, 200%, 50%)' };
		expect(resolveCellBackground(rule, 100, range)).toBe('rgba(255, 0, 0, 0.55)');
		// Lightness above 100% clamps to white.
		const bright: ColorScaleRule = { type: 'color-scale', color: 'hsl(0, 100%, 150%)' };
		expect(resolveCellBackground(bright, 100, range)).toBe('rgba(255, 255, 255, 0.55)');
	});

	it('accepts common named CSS colors', () => {
		expect(resolveCellBackground({ type: 'color-scale', color: 'red' }, 100, range)).toBe('rgba(255, 0, 0, 0.55)');
		expect(resolveCellBackground({ type: 'color-scale', color: 'green' }, 100, range)).toBe(
			'rgba(0, 128, 0, 0.55)',
		);
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

describe('resolveCellBackground - boolean', () => {
	const rule: BooleanRule = { type: 'boolean', trueColor: 'green', falseColor: 'red' };

	it('applies the true/false colors for real booleans', () => {
		expect(resolveCellBackground(rule, true, null)).toBe('green');
		expect(resolveCellBackground(rule, false, null)).toBe('red');
	});

	it('returns undefined when the matching color is unset', () => {
		expect(resolveCellBackground({ type: 'boolean', trueColor: 'green' }, false, null)).toBeUndefined();
		expect(resolveCellBackground({ type: 'boolean', falseColor: 'red' }, true, null)).toBeUndefined();
	});

	it('coerces common string/number boolean representations', () => {
		expect(resolveCellBackground(rule, 'true', null)).toBe('green');
		expect(resolveCellBackground(rule, 'FALSE', null)).toBe('red');
		expect(resolveCellBackground(rule, 1, null)).toBe('green');
		expect(resolveCellBackground(rule, 0, null)).toBe('red');
	});

	it('returns undefined for non-boolean-like values', () => {
		expect(resolveCellBackground(rule, 'maybe', null)).toBeUndefined();
		expect(resolveCellBackground(rule, 5, null)).toBeUndefined();
		expect(resolveCellBackground(rule, null, null)).toBeUndefined();
	});
});

describe('resolveCellBackground - string', () => {
	it('matches with the equals operator', () => {
		const rule: StringRule = { type: 'string', operator: 'equals', value: 'Active', color: 'green' };
		expect(resolveCellBackground(rule, 'Active', null)).toBe('green');
		expect(resolveCellBackground(rule, 'active', null)).toBeUndefined();
		expect(resolveCellBackground(rule, 'Inactive', null)).toBeUndefined();
	});

	it('matches with the in operator', () => {
		const rule: StringRule = { type: 'string', operator: 'in', value: ['A', 'B'], color: 'green' };
		expect(resolveCellBackground(rule, 'A', null)).toBe('green');
		expect(resolveCellBackground(rule, 'B', null)).toBe('green');
		expect(resolveCellBackground(rule, 'C', null)).toBeUndefined();
	});

	it('matches with the like operator (case-insensitive contains)', () => {
		const rule: StringRule = { type: 'string', operator: 'like', value: 'err', color: 'red' };
		expect(resolveCellBackground(rule, 'Server Error', null)).toBe('red');
		expect(resolveCellBackground(rule, 'ok', null)).toBeUndefined();
	});

	it('stringifies non-string cell values before matching', () => {
		const rule: StringRule = { type: 'string', operator: 'equals', value: '42', color: 'blue' };
		expect(resolveCellBackground(rule, 42, null)).toBe('blue');
	});

	it('returns undefined for nullish cells', () => {
		const rule: StringRule = { type: 'string', operator: 'like', value: 'x', color: 'red' };
		expect(resolveCellBackground(rule, null, null)).toBeUndefined();
		expect(resolveCellBackground(rule, undefined, null)).toBeUndefined();
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

	it('keeps a color-scale rule with a main color and rejects a non-string one', () => {
		expect(sanitizeConditionalFormats({ ok: { type: 'color-scale', color: '#ff0000' } })).toEqual({
			ok: { type: 'color-scale', color: '#ff0000' },
		});
		expect(sanitizeConditionalFormats({ bad: { type: 'color-scale', color: 123 } })).toBeUndefined();
	});

	it('keeps valid boolean rules and drops malformed ones', () => {
		const valid = { type: 'boolean', trueColor: 'green', falseColor: 'red' };
		expect(sanitizeConditionalFormats({ ok: valid })).toEqual({ ok: valid });
		// Empty boolean rule (both colors optional) is still structurally valid.
		expect(sanitizeConditionalFormats({ ok: { type: 'boolean' } })).toEqual({ ok: { type: 'boolean' } });
		expect(sanitizeConditionalFormats({ bad: { type: 'boolean', trueColor: 5 } })).toBeUndefined();
	});

	it('keeps valid string rules and drops malformed ones', () => {
		const equals = { type: 'string', operator: 'equals', value: 'A', color: 'green' };
		const inList = { type: 'string', operator: 'in', value: ['A', 'B'], color: 'green' };
		expect(sanitizeConditionalFormats({ ok: equals })).toEqual({ ok: equals });
		expect(sanitizeConditionalFormats({ ok: inList })).toEqual({ ok: inList });
		// "in" requires an array value.
		expect(
			sanitizeConditionalFormats({ bad: { type: 'string', operator: 'in', value: 'A', color: 'green' } }),
		).toBeUndefined();
		// "equals" requires a string value.
		expect(
			sanitizeConditionalFormats({ bad: { type: 'string', operator: 'equals', value: ['A'], color: 'green' } }),
		).toBeUndefined();
		// Missing color / bad operator.
		expect(sanitizeConditionalFormats({ bad: { type: 'string', operator: 'equals', value: 'A' } })).toBeUndefined();
		expect(
			sanitizeConditionalFormats({ bad: { type: 'string', operator: 'nope', value: 'A', color: 'green' } }),
		).toBeUndefined();
	});
});

describe('colorToHex', () => {
	it('passes through a 6-digit hex', () => {
		expect(colorToHex('#ff8800')).toBe('#ff8800');
	});

	it('expands a 3-digit hex', () => {
		expect(colorToHex('#fff')).toBe('#ffffff');
	});

	it('converts an rgba color to hex (dropping alpha)', () => {
		expect(colorToHex('rgba(255, 0, 0, 0.7)')).toBe('#ff0000');
	});

	it('converts an rgb color to hex', () => {
		expect(colorToHex('rgb(34, 197, 94)')).toBe('#22c55e');
	});

	it('converts an hsl color to hex', () => {
		expect(colorToHex('hsl(0, 100%, 50%)')).toBe('#ff0000');
	});

	it('returns null for an unparseable color', () => {
		expect(colorToHex('not-a-color')).toBeNull();
	});
});

function rgbaFrom(color: string): string {
	const [r, g, b, a] = color
		.replace(/rgba?\(|\)/g, '')
		.split(',')
		.map((part) => Number.parseFloat(part.trim()));
	return `rgba(${r}, ${g}, ${b}, ${a})`;
}
