import type { Granularity, UsagePeriod, UsageRecord } from '../types/usage';
import { DEFAULT_PERIOD_BY_GRANULARITY, PERIOD_CONFIG } from '../types/usage';

export { DEFAULT_PERIOD_BY_GRANULARITY, PERIOD_CONFIG };

export function isValidIsoDateString(s: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
		return false;
	}
	const [y, m, d] = s.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function getPeriodStartDate(period: UsagePeriod, now: Date = new Date()): Date {
	const config = PERIOD_CONFIG[period] ?? PERIOD_CONFIG['15d'];
	const date = new Date(now);

	if (config.granularity === 'month') {
		return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - (config.count - 1), 1, 0, 0, 0, 0));
	}

	if (config.granularity === 'hour') {
		date.setUTCHours(date.getUTCHours() - (config.count - 1), 0, 0, 0);
		return date;
	}

	date.setUTCDate(date.getUTCDate() - (config.count - 1));
	date.setUTCHours(0, 0, 0, 0);
	return date;
}

export function resolvePeriodAndGranularity(options?: { period?: UsagePeriod; granularity?: Granularity }): {
	period: UsagePeriod;
	granularity: Granularity;
	count: number;
	startDate: Date;
} {
	const now = new Date();
	const period =
		options?.period && PERIOD_CONFIG[options.period]
			? options.period
			: options?.granularity && DEFAULT_PERIOD_BY_GRANULARITY[options.granularity]
				? DEFAULT_PERIOD_BY_GRANULARITY[options.granularity]
				: '15d';

	const defaultGranularity = PERIOD_CONFIG[period].granularity;
	const granularity = options?.granularity ?? defaultGranularity;
	const startDate = getPeriodStartDate(period, now);

	let count: number;
	if (granularity === defaultGranularity) {
		count = PERIOD_CONFIG[period].count;
	} else if (granularity === 'month') {
		count =
			(now.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
			(now.getUTCMonth() - startDate.getUTCMonth()) +
			1;
	} else if (granularity === 'day') {
		count = Math.max(1, Math.round((now.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1);
	} else {
		count = Math.max(1, Math.round((now.getTime() - startDate.getTime()) / (60 * 60 * 1000)) + 1);
	}

	return {
		period,
		granularity,
		count,
		startDate,
	};
}

export function getLookbackTimestamp(granularity?: Granularity, period?: UsagePeriod): number {
	const resolved = resolvePeriodAndGranularity({ period, granularity });
	return resolved.startDate.getTime();
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

export function generateDateSeries(granularity?: Granularity, period?: UsagePeriod): string[] {
	const resolved = resolvePeriodAndGranularity({ period, granularity });
	const dates: string[] = [];
	const now = new Date();

	for (let i = resolved.count - 1; i >= 0; i--) {
		const date = new Date(now);

		switch (resolved.granularity) {
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

		dates.push(formatDate(date, resolved.granularity));
	}

	return dates;
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

export function fillMissingDates(
	records: UsageRecord[],
	granularity?: Granularity,
	period?: UsagePeriod,
): UsageRecord[] {
	const resolved = resolvePeriodAndGranularity({ period, granularity });
	const dateSet = new Map(records.map((r) => [r.date, r]));
	const allDates = generateDateSeries(resolved.granularity, resolved.period);

	return allDates.map(
		(date) =>
			dateSet.get(date) ?? {
				date,
				messageCount: 0,
				webMessageCount: 0,
				slackMessageCount: 0,
				teamsMessageCount: 0,
				telegramMessageCount: 0,
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
