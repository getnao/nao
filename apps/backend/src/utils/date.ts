import type { Granularity, UsageRecord } from '../types/usage';

export const lookbackPeriods = {
	hour: 24,
	day: 30,
	month: 12,
};

export function getLookbackTimestamp(granularity: Granularity): number {
	const now = Date.now();
	const periods = lookbackPeriods[granularity];

	switch (granularity) {
		case 'hour':
			return now - periods * 60 * 60 * 1000;
		case 'day':
			return now - periods * 24 * 60 * 60 * 1000;
		case 'month':
			return now - periods * 30 * 24 * 60 * 60 * 1000;
	}
}

export function formatDate(date: Date, granularity: Granularity): string {
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	const day = String(date.getUTCDate()).padStart(2, '0');
	const hour = String(date.getUTCHours()).padStart(2, '0');

	switch (granularity) {
		case 'hour':
			return `${year}-${month}-${day} ${hour}:00`;
		case 'day':
			return `${year}-${month}-${day}`;
		case 'month':
			return `${year}-${month}`;
	}
}

export function generateDateSeries(granularity: Granularity): string[] {
	const dates: string[] = [];
	const periods = lookbackPeriods[granularity];
	const now = new Date();

	for (let i = periods - 1; i >= 0; i--) {
		const date = new Date(now);

		switch (granularity) {
			case 'hour':
				date.setUTCHours(date.getUTCHours() - i, 0, 0, 0);
				break;
			case 'day':
				date.setUTCDate(date.getUTCDate() - i);
				date.setUTCHours(0, 0, 0, 0);
				break;
			case 'month':
				date.setUTCMonth(date.getUTCMonth() - i, 1);
				date.setUTCHours(0, 0, 0, 0);
				break;
		}

		dates.push(formatDate(date, granularity));
	}

	return dates;
}

export function fillMissingDates(records: UsageRecord[], granularity: Granularity): UsageRecord[] {
	const dateSet = new Map(records.map((r) => [r.date, r]));
	const allDates = generateDateSeries(granularity);

	return allDates.map(
		(date) =>
			dateSet.get(date) ?? {
				date,
				nbMessages: 0,
				inputNoCacheTokens: 0,
				inputCacheReadTokens: 0,
				inputCacheWriteTokens: 0,
				outputTotalTokens: 0,
				totalTokens: 0,
			},
	);
}
