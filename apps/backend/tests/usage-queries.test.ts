import '../src/env';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMessagesUsage, getTotalUsage } from '../src/queries/usage.queries';
import { formatDate } from '../src/utils/date';

const queryRows = vi.hoisted(() => ({ value: [] as Record<string, unknown>[] }));

vi.mock('../src/db/db', () => {
	const query = {
		select: () => query,
		from: () => query,
		innerJoin: () => query,
		leftJoin: () => query,
		where: () => query,
		groupBy: () => query,
		unionAll: () => query,
		then: (resolve: (rows: Record<string, unknown>[]) => unknown, reject: (error: unknown) => unknown) =>
			Promise.resolve(queryRows.value).then(resolve, reject),
	};

	return {
		db: {
			$with: () => ({ as: () => query }),
			select: () => query,
			with: () => query,
		},
	};
});

vi.mock('../src/queries/project-llm-config.queries', () => ({
	getProjectLlmConfigs: async () => [],
}));

describe('usage query results', () => {
	beforeEach(() => {
		queryRows.value = [];
	});

	it('normalizes total usage aggregates to numbers', async () => {
		queryRows.value = [{ totalMessages: '12', uniqueUsers: '4' }];

		await expect(getTotalUsage('project-1', { granularity: 'day' })).resolves.toEqual({
			totalMessages: 12,
			uniqueUsers: 4,
		});
	});

	it('normalizes message aggregates and includes context recommendations', async () => {
		const date = formatDate(new Date(), 'day');
		queryRows.value = [
			{
				date,
				messageCount: '8',
				webMessageCount: '1',
				slackMessageCount: '1',
				teamsMessageCount: '1',
				telegramMessageCount: '1',
				whatsappMessageCount: '1',
				adminMessageCount: '1',
				mcpMessageCount: '1',
				contextRecommendationsMessageCount: '1',
			},
		];

		const records = await getMessagesUsage('project-1', { granularity: 'day' });
		const record = records.find((item) => item.date === date);

		expect(record).toMatchObject({
			messageCount: 8,
			webMessageCount: 1,
			slackMessageCount: 1,
			teamsMessageCount: 1,
			telegramMessageCount: 1,
			whatsappMessageCount: 1,
			adminMessageCount: 1,
			mcpMessageCount: 1,
			contextRecommendationsMessageCount: 1,
		});
	});

	it('adds auxiliary LLM inference tokens and costs without increasing message counts', async () => {
		const date = formatDate(new Date(), 'day');
		queryRows.value = [
			{
				date,
				messageCount: '1',
				webMessageCount: '1',
				inputNoCacheTokens: '130',
				inputCacheReadTokens: '20',
				outputTotalTokens: '60',
				totalTokens: '210',
				inputNoCacheCost: '0.013',
				inputCacheReadCost: '0.001',
				outputCost: '0.024',
			},
		];

		const records = await getMessagesUsage('project-1', { granularity: 'day' });
		const record = records.find((item) => item.date === date);

		expect(record).toMatchObject({
			messageCount: 1,
			inputNoCacheTokens: 130,
			inputCacheReadTokens: 20,
			outputTotalTokens: 60,
			totalTokens: 210,
			inputCacheReadCost: 0.001,
			outputCost: 0.024,
		});
		expect(record?.inputNoCacheCost).toBeCloseTo(0.013);
		expect(record?.totalCost).toBeCloseTo(0.038);
	});
});
