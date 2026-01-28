import { hashValue } from './hash';

export type RangeOptions = Record<string, { label: string }>;

export const DATE_RANGE_OPTIONS = {
	'7d': { label: 'Last 7 days' },
	'30d': { label: 'Last 30 days' },
	'3m': { label: 'Last 3 months' },
	'6m': { label: 'Last 6 months' },
	'1y': { label: 'Last year' },
	all: { label: 'All data' },
} satisfies RangeOptions;

export type DateRange = keyof typeof DATE_RANGE_OPTIONS;

/** Filters data by date range preset (relative to the first date in the data, assuming data is ordered) */
export function filterByDateRange<T extends Record<string, any>>(data: T[], xAxisKey: string, range: DateRange): T[] {
	if (range === 'all' || data.length === 0) {
		return data;
	}

	const latestDate = data.at(-1)?.[xAxisKey]; // Assuming data is ordered by date
	if (latestDate == null) {
		return data;
	}

	const cutoffDate = new Date(latestDate);
	if (!isValidDate(cutoffDate)) {
		return data;
	}

	switch (range) {
		case '7d':
			cutoffDate.setTime(cutoffDate.getTime() - 7 * 24 * 60 * 60 * 1000);
			break;
		case '30d':
			cutoffDate.setTime(cutoffDate.getTime() - 30 * 24 * 60 * 60 * 1000);
			break;
		case '3m':
			cutoffDate.setMonth(cutoffDate.getMonth() - 3);
			break;
		case '6m':
			cutoffDate.setMonth(cutoffDate.getMonth() - 6);
			break;
		case '1y':
			cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
			break;
		default:
			return data;
	}

	return data.filter((item) => {
		const dateValue = item[xAxisKey];
		const date = new Date(dateValue);
		if (!isValidDate(date)) {
			return false;
		}

		return date >= cutoffDate;
	});
}

function isValidDate(date: Date): boolean {
	return !isNaN(date.getTime());
}

/** Checks if a string is in ISO 8601 date format (e.g., 2024-01-15 or 2024-01-15T12:30:00Z) */
function isISODateString(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/.test(value);
}

/** Converts a data key to a human readable label */
export const labelize = (key: any) => {
	if (typeof key === 'string' && isISODateString(key)) {
		const date = new Date(key);
		if (isValidDate(date)) {
			return date.toDateString();
		}
	}
	return String(key)
		.replace(/_/g, ' ')
		.replace(/\b\w/g, (char) => char.toUpperCase());
};

export const toKey = (value: string) => {
	return hashValue(value);
};
