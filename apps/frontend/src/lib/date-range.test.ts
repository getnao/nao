import { describe, expect, it } from 'vitest';

import {
	DATE_RANGE_PRESETS,
	countRangeDays,
	findMatchingPreset,
	formatShortRange,
	getInitialMonth,
	getPreviewRange,
	selectDay,
} from './date-range';

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

	it('forgets the chosen preset once a day is picked', () => {
		const selection = selectDay(
			{ range: { from: day(10, 1), to: day(10, 19) }, activeField: null, presetId: 'this-quarter' },
			day(10, 8),
		);
		expect(selection.presetId).toBeUndefined();
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

	it('matches every preset to its own range when no presets overlap', () => {
		const midQuarterDay = day(11, 19);
		for (const preset of DATE_RANGE_PRESETS) {
			const range = preset.getRange(midQuarterDay);
			expect(range.from.getTime()).toBeLessThanOrEqual(range.to.getTime());
			expect(findMatchingPreset(range, midQuarterDay)?.id).toBe(preset.id);
		}
	});
});

describe('getInitialMonth', () => {
	it('shows the range end in the last visible month', () => {
		const range = { from: day(8, 10), to: day(10, 5) };
		expect(getInitialMonth(range, 2, today)).toEqual(day(9, 1));
		expect(getInitialMonth(range, 1, today)).toEqual(day(10, 1));
	});

	it('falls back to today without a selection', () => {
		expect(getInitialMonth(undefined, 2, today)).toEqual(day(9, 1));
	});
});

describe('formatShortRange', () => {
	it('omits the start year when both dates share a year', () => {
		expect(formatShortRange({ from: day(9, 20), to: day(10, 19) })).toBe('Sep 20 – Oct 19, 2026');
		expect(formatShortRange({ from: new Date(2025, 11, 1), to: day(1, 31) })).toBe('Dec 1, 2025 – Jan 31, 2026');
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
