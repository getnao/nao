import type { displayChart } from '@nao/shared/tools';
import type { UsageByUserRecord, UserUsageBreakdown } from '@nao/backend/usage';

export type UserUsageMetric = keyof Omit<UserUsageBreakdown, 'userName'>;

export const MAX_USER_SERIES = 10;
export const MAX_USER_LEGEND_ENTRIES = 5;
export const OTHER_USERS_KEY = 'others';
export const OTHER_USERS_LABEL = 'Others';

export interface UserUsageChart {
	data: Record<string, string | number>[];
	series: displayChart.SeriesConfig[];
	showLegend: boolean;
}

/**
 * Pivots per-date user breakdowns into one stacked series per user. Users are ranked by
 * their total for the metric; only the top ones get their own series and the long tail is
 * folded into a single "Others" series so the chart stays readable.
 */
export function buildUserUsageChart(
	records: UsageByUserRecord[],
	metric: UserUsageMetric,
	valueFormat?: displayChart.ValueFormat,
): UserUsageChart {
	const rankedUsers = rankUsersByMetric(records, metric);
	const topUsers = rankedUsers.slice(0, MAX_USER_SERIES);
	const hasOtherUsers = rankedUsers.length > topUsers.length;
	const seriesKeyByUser = new Map(topUsers.map((userName, index) => [userName, `user_${index}`]));
	const seriesKeys = [...seriesKeyByUser.values(), ...(hasOtherUsers ? [OTHER_USERS_KEY] : [])];

	const data = records.map((record) => {
		const row: Record<string, string | number> = { date: record.date };
		for (const key of seriesKeys) {
			row[key] = 0;
		}
		for (const user of record.users) {
			const key = seriesKeyByUser.get(user.userName);
			if (key) {
				row[key] = Number(row[key]) + user[metric];
			} else if (hasOtherUsers) {
				row[OTHER_USERS_KEY] = Number(row[OTHER_USERS_KEY]) + user[metric];
			}
		}
		return row;
	});

	const series: displayChart.SeriesConfig[] = topUsers.map((userName, index) => ({
		data_key: `user_${index}`,
		label: userName,
		color: `var(--chart-${index + 1})`,
		value_format: valueFormat,
	}));
	if (hasOtherUsers) {
		series.push({
			data_key: OTHER_USERS_KEY,
			label: OTHER_USERS_LABEL,
			color: 'var(--muted-foreground)',
			value_format: valueFormat,
		});
	}

	return { data, series, showLegend: series.length <= MAX_USER_LEGEND_ENTRIES };
}

function rankUsersByMetric(records: UsageByUserRecord[], metric: UserUsageMetric): string[] {
	const totals = new Map<string, number>();
	for (const record of records) {
		for (const user of record.users) {
			totals.set(user.userName, (totals.get(user.userName) ?? 0) + user[metric]);
		}
	}

	return [...totals.entries()]
		.filter(([, total]) => total > 0)
		.sort(([nameA, totalA], [nameB, totalB]) => totalB - totalA || nameA.localeCompare(nameB))
		.map(([userName]) => userName);
}
