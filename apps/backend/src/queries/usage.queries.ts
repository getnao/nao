import { and, count, eq, isNotNull,SQL, sql, SQLWrapper, sum } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import type { LlmProvider } from '../types/llm';
import type { Granularity, UsageFilter, UsageRecord } from '../types/usage';

const sqliteFormats = {
	hour: '%Y-%m-%d %H:00',
	day: '%Y-%m-%d',
	month: '%Y-%m',
};

const pgFormats = {
	hour: 'YYYY-MM-DD HH24:00',
	day: 'YYYY-MM-DD',
	month: 'YYYY-MM',
};

const lookbackPeriods = {
	hour: 24,
	day: 30,
	month: 12,
};

function getLookbackTimestamp(granularity: Granularity): number {
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

function formatDate(date: Date, granularity: Granularity): string {
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

function generateDateSeries(granularity: Granularity): string[] {
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

function fillMissingDates(records: UsageRecord[], granularity: Granularity): UsageRecord[] {
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

function getDateExpr(field: SQLWrapper, granularity: Granularity): SQL<string> {
	if (dbConfig.dialect === Dialect.Postgres) {
		const format = sql.raw(`'${pgFormats[granularity]}'`);
		return sql<string>`to_char(to_timestamp(${field} / 1000.0), ${format})`;
	} else {
		const format = sql.raw(`'${sqliteFormats[granularity]}'`);
		return sql<string>`strftime(${format}, ${field} / 1000, 'unixepoch')`;
	}
}

export const getMessagesUsage = async (projectId: string, filter: UsageFilter): Promise<UsageRecord[]> => {
	const { granularity, provider } = filter;
	const dateExpr = getDateExpr(s.chatMessage.createdAt, granularity);
	const lookbackTs = getLookbackTimestamp(granularity);

	const whereConditions = [
		eq(s.chat.projectId, projectId),
		sql`${s.chatMessage.createdAt} >= ${lookbackTs}`,
	];

	if (provider) {
		whereConditions.push(eq(s.chatMessage.llmProvider, provider));
	}

	const rows = await db
		.select({
			date: dateExpr,
			nbMessages: count(),
			inputNoCacheTokens: sum(s.messagePart.inputNoCacheTokens),
			inputCacheReadTokens: sum(s.messagePart.inputCacheReadTokens),
			inputCacheWriteTokens: sum(s.messagePart.inputCacheWriteTokens),
			outputTotalTokens: sum(s.messagePart.outputTotalTokens),
			totalTokens: sum(s.messagePart.totalTokens),
		})
		.from(s.chatMessage)
		.innerJoin(s.chat, eq(s.chatMessage.chatId, s.chat.id))
		.innerJoin(s.messagePart, eq(s.messagePart.messageId, s.chatMessage.id))
		.where(and(...whereConditions))
		.groupBy(dateExpr)
		.execute();

	const mappedRows = rows.map((row) => ({
		...row,
		inputNoCacheTokens: Number(row.inputNoCacheTokens ?? 0),
		inputCacheReadTokens: Number(row.inputCacheReadTokens ?? 0),
		inputCacheWriteTokens: Number(row.inputCacheWriteTokens ?? 0),
		outputTotalTokens: Number(row.outputTotalTokens ?? 0),
		totalTokens: Number(row.totalTokens ?? 0),
	}));

	return fillMissingDates(mappedRows, granularity);
};

export const getUsedProviders = async (projectId: string): Promise<LlmProvider[]> => {
	const rows = await db
		.selectDistinct({ provider: s.chatMessage.llmProvider })
		.from(s.chatMessage)
		.innerJoin(s.chat, eq(s.chatMessage.chatId, s.chat.id))
		.where(and(eq(s.chat.projectId, projectId), isNotNull(s.chatMessage.llmProvider)))
		.execute();

	return rows.map((row) => row.provider).filter((p): p is LlmProvider => p !== null);
};
