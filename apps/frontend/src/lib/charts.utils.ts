import { getToolName, isToolUIPart } from './ai';
import { hashValue } from './hash';
import type { UIMessage } from '@nao/backend/chat';

export { labelize } from '@nao/shared';

export type RangeOptions = Record<string, { label: string }>;

// TODO: make this dynamic based on the data
export const DATE_RANGE_OPTIONS = {
	'7d': { label: 'Last 7 days' },
	'30d': { label: 'Last 30 days' },
	'3m': { label: 'Last 3 months' },
	'6m': { label: 'Last 6 months' },
	'1y': { label: 'Last year' },
	all: { label: 'All data' },
} satisfies RangeOptions;

export type DateRange = keyof typeof DATE_RANGE_OPTIONS;

/** Filters data by date range preset (relative to the latest date in the data, expects ascending sort) */
export function filterByDateRange<T extends Record<string, any>>(data: T[], xAxisKey: string, range: DateRange): T[] {
	if (range === 'all' || data.length === 0) {
		return data;
	}

	const latestDate = data.at(-1)?.[xAxisKey];
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

/** Sorts data chronologically (ascending) by a date key so charts render left-to-right */
export function sortByDateKey<T extends Record<string, any>>(data: T[], xAxisKey: string): T[] {
	return [...data].sort((a, b) => {
		const dateA = new Date(a[xAxisKey]);
		const dateB = new Date(b[xAxisKey]);
		const validA = isValidDate(dateA);
		const validB = isValidDate(dateB);
		if (!validA || !validB) {
			if (!validA && !validB) {
				return 0;
			}
			return validA ? -1 : 1;
		}
		return dateA.getTime() - dateB.getTime();
	});
}

function isValidDate(date: Date): boolean {
	return !isNaN(date.getTime());
}

export const toKey = (value: string) => {
	return hashValue(value);
};

/** Counts the successfully rendered `display_chart` tool calls across a conversation. */
export function countDisplayCharts(messages: UIMessage[]): number {
	let count = 0;
	for (const message of messages) {
		for (const part of message.parts) {
			if (
				isToolUIPart(part) &&
				getToolName(part) === 'display_chart' &&
				part.state === 'output-available' &&
				!(part.output as { error?: string } | undefined)?.error
			) {
				count++;
			}
		}
	}
	return count;
}
