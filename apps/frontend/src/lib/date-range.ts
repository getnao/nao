import {
	addDays,
	differenceInCalendarDays,
	endOfMonth,
	endOfYear,
	format,
	isAfter,
	isBefore,
	isSameDay,
	startOfDay,
	startOfMonth,
	startOfQuarter,
	startOfYear,
	subDays,
	subMonths,
	subYears,
} from 'date-fns';
import type { DateRange } from 'react-day-picker';

export type DateRangeField = 'start' | 'end';

export type DateRangePreset = {
	id: string;
	label: string;
	getRange: (today: Date) => { from: Date; to: Date };
};

export type DateRangeSelection = {
	range: DateRange | undefined;
	activeField: DateRangeField | null;
	presetId?: string;
};

export const DATE_RANGE_PRESETS: DateRangePreset[] = [
	{ id: 'today', label: 'Today', getRange: (today) => ({ from: today, to: today }) },
	{
		id: 'yesterday',
		label: 'Yesterday',
		getRange: (today) => ({ from: subDays(today, 1), to: subDays(today, 1) }),
	},
	{ id: 'last-7-days', label: 'Last 7 days', getRange: (today) => ({ from: subDays(today, 6), to: today }) },
	{ id: 'last-30-days', label: 'Last 30 days', getRange: (today) => ({ from: subDays(today, 29), to: today }) },
	{ id: 'this-month', label: 'This month', getRange: (today) => ({ from: startOfMonth(today), to: today }) },
	{
		id: 'last-month',
		label: 'Last month',
		getRange: (today) => ({
			from: startOfMonth(subMonths(today, 1)),
			to: endOfMonth(subMonths(today, 1)),
		}),
	},
	{ id: 'this-quarter', label: 'This quarter', getRange: (today) => ({ from: startOfQuarter(today), to: today }) },
	{ id: 'year-to-date', label: 'Year to date', getRange: (today) => ({ from: startOfYear(today), to: today }) },
	{
		id: 'last-12-months',
		label: 'Last 12 months',
		getRange: (today) => ({ from: addDays(subYears(today, 1), 1), to: today }),
	},
	{
		id: 'last-year',
		label: 'Last year',
		getRange: (today) => ({ from: startOfYear(subYears(today, 1)), to: endOfYear(subYears(today, 1)) }),
	},
];

export function findMatchingPreset(
	range: DateRange | undefined,
	today: Date = startOfDay(new Date()),
): DateRangePreset | undefined {
	if (!range?.from || !range.to) {
		return undefined;
	}
	const { from, to } = range;
	return DATE_RANGE_PRESETS.find((preset) => {
		const presetRange = preset.getRange(today);
		return isSameDay(presetRange.from, from) && isSameDay(presetRange.to, to);
	});
}

export function selectDay(selection: DateRangeSelection, day: Date): DateRangeSelection {
	const { range, activeField } = selection;

	if (activeField === 'start') {
		const keptEnd = range?.to && !isBefore(range.to, day) ? range.to : undefined;
		return { range: { from: day, to: keptEnd }, activeField: keptEnd ? null : 'end' };
	}

	if (activeField === 'end' && range?.from && !isBefore(day, range.from)) {
		return { range: { from: range.from, to: day }, activeField: null };
	}

	return { range: { from: day, to: undefined }, activeField: 'end' };
}

export function getPreviewRange(selection: DateRangeSelection, hoveredDay: Date | undefined): DateRange | undefined {
	const from = selection.range?.from;
	if (selection.activeField !== 'end' || !from || !hoveredDay || !isAfter(hoveredDay, from)) {
		return undefined;
	}
	return { from, to: hoveredDay };
}

export function countRangeDays(range: DateRange | undefined): number {
	if (!range?.from || !range.to) {
		return 0;
	}
	return differenceInCalendarDays(range.to, range.from) + 1;
}

export function formatRangeDate(date: Date | undefined): string {
	return date ? format(date, 'MMM d, yyyy') : '';
}

export function formatShortRange(range: DateRange): string {
	if (!range.from || !range.to) {
		return formatRangeDate(range.from);
	}
	const sameYear = range.from.getFullYear() === range.to.getFullYear();
	const fromLabel = format(range.from, sameYear ? 'MMM d' : 'MMM d, yyyy');
	return `${fromLabel} – ${format(range.to, 'MMM d, yyyy')}`;
}

export function getInitialMonth(
	range: DateRange | undefined,
	numberOfMonths: number,
	today: Date = startOfDay(new Date()),
): Date {
	const lastVisibleDay = range?.to ?? range?.from ?? today;
	return startOfMonth(subMonths(lastVisibleDay, numberOfMonths - 1));
}
