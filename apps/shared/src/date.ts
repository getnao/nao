import type { BudgetPeriod } from './types';

export function getCurrentPeriodStart(period: BudgetPeriod): Date {
	const now = new Date();
	switch (period) {
		case 'day':
			return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
		case 'week': {
			const dayOfWeek = now.getUTCDay();
			const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
			return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - mondayOffset));
		}
		case 'month':
			return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	}
}

export function getNextPeriodStart(period: BudgetPeriod): Date {
	const start = getCurrentPeriodStart(period);
	switch (period) {
		case 'day':
			return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 1));
		case 'week':
			return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 7));
		case 'month':
			return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
	}
}

export const DATE_FORMAT_PRESETS = ['european', 'american', 'iso', 'custom'] as const;
export type DateFormatPreset = (typeof DATE_FORMAT_PRESETS)[number];

export interface DateFormatSettings {
	preset: DateFormatPreset;
	customFormat?: string;
}

/**
 * Project-level display settings persisted on the project row.
 *
 * Currently only carries the date format used in chart axes, tooltips,
 * legends and SQL query result tables, but is shaped as an object so we can
 * add more display preferences (number format, timezone, …) without another
 * migration.
 */
export interface DisplaySettings {
	dateFormat?: DateFormatSettings;
}

export const DEFAULT_DATE_FORMAT_SETTINGS: DateFormatSettings = {
	preset: 'european',
};

export const DATE_FORMAT_PRESET_PATTERNS: Record<Exclude<DateFormatPreset, 'custom'>, string> = {
	european: 'DD/MM/YYYY',
	american: 'MM/DD/YYYY',
	iso: 'YYYY-MM-DD',
};

/**
 * Tokens supported by {@link formatDateValue}. We document these inline in the
 * settings UI rather than linking out to date-fns, since we only support a
 * focused subset and using date-fns tokens (e.g. `yyyy-MM-dd`) would silently
 * produce wrong output.
 */
export const SUPPORTED_DATE_FORMAT_TOKENS: Array<{ token: string; description: string }> = [
	{ token: 'YYYY', description: '4-digit year (e.g. 2024)' },
	{ token: 'YY', description: '2-digit year (e.g. 24)' },
	{ token: 'MMMM', description: 'Month name (e.g. March)' },
	{ token: 'MMM', description: 'Short month name (e.g. Mar)' },
	{ token: 'MM', description: '0-padded month (e.g. 03)' },
	{ token: 'M', description: 'Numeric month (e.g. 3)' },
	{ token: 'DD', description: '0-padded day (e.g. 05)' },
	{ token: 'D', description: 'Numeric day (e.g. 5)' },
	{ token: 'dddd', description: 'Weekday (e.g. Friday)' },
	{ token: 'ddd', description: 'Short weekday (e.g. Fri)' },
];

/**
 * Strict ISO date check: accept either a date-only `YYYY-MM-DD` or a full
 * datetime with an explicit timezone offset (`Z` or `±HH:MM`). Naive datetime
 * strings without a timezone are rejected because converting them via
 * `new Date(...)` would silently shift the day in the local timezone.
 */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

/**
 * Returns true when the input looks like an ISO date (date-only or datetime
 * with explicit timezone) and parses to a real Date.
 */
export function isIsoDateLike(value: unknown): boolean {
	return typeof value === 'string' && isIsoDateString(value);
}

function isIsoDateString(value: string): boolean {
	if (!ISO_DATE_REGEX.test(value)) {
		return false;
	}
	return !isNaN(new Date(value).getTime());
}

/**
 * Resolves the effective pattern for the given settings, falling back to the
 * European preset when the custom pattern is missing.
 */
export function resolveDateFormatPattern(settings?: DateFormatSettings | null): string {
	const preset = settings?.preset ?? DEFAULT_DATE_FORMAT_SETTINGS.preset;
	if (preset === 'custom') {
		const trimmed = settings?.customFormat?.trim();
		if (trimmed) {
			return trimmed;
		}
		return DATE_FORMAT_PRESET_PATTERNS.european;
	}
	return DATE_FORMAT_PRESET_PATTERNS[preset];
}

/**
 * Formats an ISO date-like value using one of {@link SUPPORTED_DATE_FORMAT_TOKENS},
 * in UTC. Quoted segments wrapped in `[...]` are emitted verbatim. Non-date
 * inputs are stringified unchanged.
 */
export function formatDateValue(value: unknown, settings?: DateFormatSettings | null): string {
	if (typeof value !== 'string' || !isIsoDateString(value)) {
		return String(value ?? '');
	}
	const date = new Date(value);
	const pattern = resolveDateFormatPattern(settings);
	return formatDateWithPattern(date, pattern);
}

const MONTH_NAMES_LONG = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];
const MONTH_NAMES_SHORT = MONTH_NAMES_LONG.map((m) => m.slice(0, 3));
const WEEKDAY_NAMES_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_NAMES_SHORT = WEEKDAY_NAMES_LONG.map((w) => w.slice(0, 3));

const TOKEN_REGEX = /YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|\[([^\]]*)\]/g;

function formatDateWithPattern(date: Date, pattern: string): string {
	const year = date.getUTCFullYear();
	const monthIndex = date.getUTCMonth();
	const day = date.getUTCDate();
	const weekdayIndex = date.getUTCDay();

	return pattern.replace(TOKEN_REGEX, (token, literal: string | undefined) => {
		if (literal !== undefined) {
			return literal;
		}
		switch (token) {
			case 'YYYY':
				return String(year).padStart(4, '0');
			case 'YY':
				return String(year % 100).padStart(2, '0');
			case 'MMMM':
				return MONTH_NAMES_LONG[monthIndex];
			case 'MMM':
				return MONTH_NAMES_SHORT[monthIndex];
			case 'MM':
				return String(monthIndex + 1).padStart(2, '0');
			case 'M':
				return String(monthIndex + 1);
			case 'DD':
				return String(day).padStart(2, '0');
			case 'D':
				return String(day);
			case 'dddd':
				return WEEKDAY_NAMES_LONG[weekdayIndex];
			case 'ddd':
				return WEEKDAY_NAMES_SHORT[weekdayIndex];
			default:
				return token;
		}
	});
}
