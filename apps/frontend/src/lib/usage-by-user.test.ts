import { describe, expect, it } from 'vitest';

import {
	buildUserUsageChart,
	MAX_USER_LEGEND_ENTRIES,
	MAX_USER_SERIES,
	OTHER_USERS_KEY,
	OTHER_USERS_LABEL,
} from './usage-by-user';
import type { UsageByUserRecord } from '@nao/backend/usage';

function user(userName: string, messageCount: number, totalTokens = 0, totalCost = 0) {
	return { userName, messageCount, totalTokens, totalCost };
}

describe('buildUserUsageChart', () => {
	it('pivots users into one series per user ordered by their total', () => {
		const records: UsageByUserRecord[] = [
			{ date: '2026-09-01', users: [user('Alice', 1), user('Bob', 5)] },
			{ date: '2026-09-02', users: [] },
			{ date: '2026-09-03', users: [user('Alice', 2)] },
		];

		const chart = buildUserUsageChart(records, 'messageCount');

		expect(chart.series.map(({ data_key, label }) => [data_key, label])).toEqual([
			['user_0', 'Bob'],
			['user_1', 'Alice'],
		]);
		expect(chart.data).toEqual([
			{ date: '2026-09-01', user_0: 5, user_1: 1 },
			{ date: '2026-09-02', user_0: 0, user_1: 0 },
			{ date: '2026-09-03', user_0: 0, user_1: 2 },
		]);
		expect(chart.showLegend).toBe(true);
	});

	it('uses the requested metric and forwards the value format', () => {
		const records: UsageByUserRecord[] = [
			{ date: '2026-09-01', users: [user('Alice', 1, 100, 0.5), user('Bob', 1, 10, 2)] },
		];
		const valueFormat = { prefix: '$' };

		const tokens = buildUserUsageChart(records, 'totalTokens');
		const cost = buildUserUsageChart(records, 'totalCost', valueFormat);

		expect(tokens.series.map(({ label }) => label)).toEqual(['Alice', 'Bob']);
		expect(tokens.data).toEqual([{ date: '2026-09-01', user_0: 100, user_1: 10 }]);
		expect(cost.series.map(({ label }) => label)).toEqual(['Bob', 'Alice']);
		expect(cost.data).toEqual([{ date: '2026-09-01', user_0: 2, user_1: 0.5 }]);
		expect(cost.series.every((series) => series.value_format === valueFormat)).toBe(true);
	});

	it('drops users without any usage for the metric', () => {
		const records: UsageByUserRecord[] = [{ date: '2026-09-01', users: [user('Alice', 3), user('Idle', 0, 50)] }];

		const chart = buildUserUsageChart(records, 'messageCount');

		expect(chart.series.map(({ label }) => label)).toEqual(['Alice']);
		expect(chart.data).toEqual([{ date: '2026-09-01', user_0: 3 }]);
	});

	it('folds the long tail of small users into an "Others" series', () => {
		const users = Array.from({ length: MAX_USER_SERIES + 3 }, (_, index) =>
			user(`User ${String(index).padStart(2, '0')}`, 100 - index),
		);
		const records: UsageByUserRecord[] = [{ date: '2026-09-01', users }];

		const chart = buildUserUsageChart(records, 'messageCount');
		const others = chart.series.at(-1);

		expect(chart.series).toHaveLength(MAX_USER_SERIES + 1);
		expect(others).toMatchObject({ data_key: OTHER_USERS_KEY, label: OTHER_USERS_LABEL });
		expect(chart.series.slice(0, MAX_USER_SERIES).map(({ label }) => label)).toEqual(
			users.slice(0, MAX_USER_SERIES).map(({ userName }) => userName),
		);
		expect(chart.data[0]?.[OTHER_USERS_KEY]).toBe(100 - 10 + (100 - 11) + (100 - 12));
	});

	it('hides the legend once more than the readable number of users are displayed', () => {
		const records: UsageByUserRecord[] = [
			{
				date: '2026-09-01',
				users: Array.from({ length: MAX_USER_LEGEND_ENTRIES + 1 }, (_, index) => user(`User ${index}`, 1)),
			},
		];

		expect(buildUserUsageChart(records, 'messageCount').showLegend).toBe(false);
		expect(
			buildUserUsageChart([{ date: '2026-09-01', users: records[0].users.slice(1) }], 'messageCount').showLegend,
		).toBe(true);
	});
});
