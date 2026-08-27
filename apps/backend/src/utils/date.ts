import type { Granularity, UsagePeriod, UsageRecord } from '../types/usage';

export function isValidIsoDateString(s: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
		return false;
	}
	const [y, m, d] = s.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export const PERIOD_CONFIG: Record<UsagePeriod, { count: number; granularity: Granularity }> = {
	'24h': { count: 24, granularity: 'hour' },
	'7d': { count: 7, granularity: 'day' },
	'15d': { count: 15, granularity: 'day' },
	'30d': { count: 30, granularity: 'day' },
	'60d': { count: 60, granularity: 'day' },
	'90d': { count: 90, granularity: 'day' },
	'6m': { count: 6, granularity: 'month' },
};

export const DEFAULT_PERIOD_BY_GRANULARITY: Record<Granularity, UsagePeriod> = {
	hour: '24h',
	day: '15d',
	month: '6m',
};

export const lookbackPeriods = {
	hour: 24,
	day: 15,
	month: 6,
};

export function resolvePeriodAndGranularity(options?: { period?: UsagePeriod; granularity?: Granularity }): {
	period: UsagePeriod;
	granularity: Granularity;
	count: number;
} {
	if (options?.period && PERIOD_CONFIG[options.period]) {
		const config = PERIOD_CONFIG[options.period];
		return {
			period: options.period,
			granularity: options.granularity ?? config.granularity,
			count: config.count,
		};
	}
	if (options?.granularity && DEFAULT_PERIOD_BY_GRANULARITY[options.granularity]) {
		const period = DEFAULT_PERIOD_BY_GRANULARITY[options.granularity];
		const config = PERIOD_CONFIG[period];
		return {
			period,
			granularity: options.granularity,
			count: config.count,
		};
	}
	return {
		period: '15d',
		granularity: 'day',
		count: 15,
	};
}

export function getLookbackTimestamp(granularity?: Granularity, period?: UsagePeriod): number {
	const resolved = resolvePeriodAndGranularity({ period, granularity });
	const now = new Date();

	if (resolved.granularity === 'month') {
		// Include the current partial month plus (count - 1) preceding complete months.
		// Start at UTC 00:00:00 on the 1st day of the starting month.
		const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (resolved.count - 1), 1, 0, 0, 0, 0));
		return start.getTime();
	}

	if (resolved.granularity === 'hour') {
		return now.getTime() - resolved.count * 60 * 60 * 1000;
	}

	return now.getTime() - resolved.count * 24 * 60 * 60 * 1000;
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
