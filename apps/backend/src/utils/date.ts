import {
	type Granularity,
	resolveUsageChartGranularity,
	type UsagePeriodRange,
	type UsageRecord,
} from '../types/usage';

export function isValidIsoDateString(s: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
		return false;
	}
	const [y, m, d] = s.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function getLookbackTimestamp(period: UsagePeriodRange): number {
	const now = Date.now();

	switch (period.unit) {
		case 'hour':
			return now - period.value * 60 * 60 * 1000;
		case 'day':
			return now - period.value * 24 * 60 * 60 * 1000;
		case 'month': {
			const start = new Date(now);
			start.setUTCMonth(start.getUTCMonth() - period.value);
			return start.getTime();
		}
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

export function generateDateSeries(period: UsagePeriodRange): string[] {
	const granularity = resolveUsageChartGranularity(period);
	if (granularity !== period.unit) {
		return generateCoarsenedDateSeries(period, granularity);
	}

	const dates: string[] = [];
	const now = new Date();

	for (let i = period.value - 1; i >= 0; i--) {
		const date = new Date(now);
		moveToBucket(date, granularity, i);
		dates.push(formatDate(date, granularity));
	}

	return dates;
}

function generateCoarsenedDateSeries(period: UsagePeriodRange, granularity: Granularity): string[] {
	const dates: string[] = [];
	const firstBucket = new Date(getLookbackTimestamp(period));
	moveToBucket(firstBucket, granularity, 0);
	const date = new Date();
	moveToBucket(date, granularity, 0);

	while (date.getTime() >= firstBucket.getTime()) {
		dates.unshift(formatDate(date, granularity));
		moveToBucket(date, granularity, 1);
	}

	return dates;
}

function moveToBucket(date: Date, granularity: Granularity, bucketsBack: number): void {
	switch (granularity) {
		case 'hour':
			date.setUTCHours(date.getUTCHours() - bucketsBack, 0, 0, 0);
			break;
		case 'day':
			date.setUTCDate(date.getUTCDate() - bucketsBack);
			date.setUTCHours(0, 0, 0, 0);
			break;
		case 'month':
			date.setUTCMonth(date.getUTCMonth() - bucketsBack, 1);
			date.setUTCHours(0, 0, 0, 0);
			break;
	}
}

export function resolveTimezone(timezone?: string): string {
	if (!timezone) {
		return 'UTC';
	}
	try {
		Intl.DateTimeFormat(undefined, { timeZone: timezone });
		return timezone;
	} catch {
		return 'UTC';
	}
}

export function formatCurrentDate(timezone?: string): string {
	const tz = resolveTimezone(timezone);
	const formatted = new Date().toLocaleDateString('en-US', {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		timeZone: tz,
	});
	return tz === 'UTC' ? `${formatted} (UTC)` : `${formatted} (${tz})`;
}

export function fillMissingDates(records: UsageRecord[], period: UsagePeriodRange): UsageRecord[] {
	const dateSet = new Map(records.map((r) => [r.date, r]));
	const allDates = generateDateSeries(period);

	return allDates.map(
		(date) =>
			dateSet.get(date) ?? {
				date,
				messageCount: 0,
				webMessageCount: 0,
				slackMessageCount: 0,
				teamsMessageCount: 0,
				telegramMessageCount: 0,
				mattermostMessageCount: 0,
				whatsappMessageCount: 0,
				adminMessageCount: 0,
				mcpMessageCount: 0,
				contextRecommendationsMessageCount: 0,
				inputNoCacheTokens: 0,
				inputCacheReadTokens: 0,
				inputCacheWriteTokens: 0,
				outputTotalTokens: 0,
				totalTokens: 0,
				inputNoCacheCost: 0,
				inputCacheReadCost: 0,
				inputCacheWriteCost: 0,
				outputCost: 0,
				totalCost: 0,
			},
	);
}
