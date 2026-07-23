import '../src/env';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMessagesUsage, getTotalUsage } from '../src/queries/usage.queries';
import { formatDate } from '../src/utils/date';

const queryRows = vi.hoisted(() => ({ value: [] as Record<string, unknown>[] }));

vi.mock('../src/db/db', () => {
	const query = {
		from: () => query,
		innerJoin: () => query,
		leftJoin: () => query,
		where: () => query,
		groupBy: async () => queryRows.value,
		then: (resolve: (rows: Record<string, unknown>[]) => unknown, reject: (error: unknown) => unknown) =>
			Promise.resolve(queryRows.value).then(resolve, reject),
	};

	return {
		db: {
			select: () => query,
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
});
