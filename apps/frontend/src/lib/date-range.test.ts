import { describe, expect, it } from 'vitest';

import { countRangeDays, findMatchingPreset, getPreviewRange, selectDay } from './date-range';

const today = new Date(2026, 9, 19);
const day = (month: number, date: number) => new Date(2026, month - 1, date);

describe('selectDay', () => {
	it('guides the user from start date to end date', () => {
		const afterStart = selectDay({ range: undefined, activeField: 'start' }, day(10, 3));
		expect(afterStart).toEqual({ range: { from: day(10, 3), to: undefined }, activeField: 'end' });

		const afterEnd = selectDay(afterStart, day(10, 12));
		expect(afterEnd).toEqual({ range: { from: day(10, 3), to: day(10, 12) }, activeField: null });
	});

	it('restarts the range when the end date is before the start date', () => {
		const selection = selectDay({ range: { from: day(10, 10), to: undefined }, activeField: 'end' }, day(10, 2));
		expect(selection).toEqual({ range: { from: day(10, 2), to: undefined }, activeField: 'end' });
	});

	it('starts a new range when clicking after a complete selection', () => {
		const selection = selectDay({ range: { from: day(10, 1), to: day(10, 5) }, activeField: null }, day(10, 8));
		expect(selection).toEqual({ range: { from: day(10, 8), to: undefined }, activeField: 'end' });
	});

	it('keeps the end date when editing the start date of a valid range', () => {
		const selection = selectDay({ range: { from: day(10, 1), to: day(10, 20) }, activeField: 'start' }, day(10, 4));
		expect(selection).toEqual({ range: { from: day(10, 4), to: day(10, 20) }, activeField: null });
	});
});

describe('findMatchingPreset', () => {
	it('recognises a preset range', () => {
		expect(findMatchingPreset({ from: day(9, 20), to: day(10, 19) }, today)?.id).toBe('last-30-days');
		expect(findMatchingPreset({ from: day(9, 1), to: day(9, 30) }, today)?.id).toBe('last-month');
	});

	it('returns nothing for a custom range', () => {
		expect(findMatchingPreset({ from: day(9, 3), to: day(10, 2) }, today)).toBeUndefined();
	});
});

describe('getPreviewRange', () => {
	it('previews the hovered span while picking the end date', () => {
		const selection = { range: { from: day(10, 3), to: undefined }, activeField: 'end' as const };
		expect(getPreviewRange(selection, day(10, 9))).toEqual({ from: day(10, 3), to: day(10, 9) });
		expect(getPreviewRange(selection, day(10, 1))).toBeUndefined();
	});
});

describe('countRangeDays', () => {
	it('counts both boundaries', () => {
		expect(countRangeDays({ from: day(10, 1), to: day(10, 1) })).toBe(1);
		expect(countRangeDays({ from: day(9, 20), to: day(10, 19) })).toBe(30);
	});
});
