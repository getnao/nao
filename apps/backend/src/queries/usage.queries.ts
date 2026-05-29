import type { LlmProvider } from '@nao/shared/types';
import { and, eq, isNotNull, SQL, sql, SQLWrapper, sum } from 'drizzle-orm';

import { LLM_PROVIDERS } from '../agents/providers';
import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import type { Granularity, UsageFilter, UsageRecord } from '../types/usage';
import { fillMissingDates, getLookbackTimestamp } from '../utils/date';
import * as projectLlmConfigQueries from './project-llm-config.queries';

const COST_COLS = [
	'provider',
	'model_id',
	'input_no_cache',
	'input_cache_read',
	'input_cache_write',
	'output',
] as const;

type CostLookupTuple = readonly [
	provider: string,
	modelId: string,
	inputNoCache: number,
	inputCacheRead: number,
	inputCacheWrite: number,
	output: number,
];

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

const COST_EXPR = {
	inputNoCache: sql<number>`coalesce(${s.chatMessage.inputNoCacheTokens}, 0) * coalesce(cost_lookup.input_no_cache, 0) / 1000000.0`,
	inputCacheRead: sql<number>`coalesce(${s.chatMessage.inputCacheReadTokens}, 0) * coalesce(cost_lookup.input_cache_read, 0) / 1000000.0`,
	inputCacheWrite: sql<number>`coalesce(${s.chatMessage.inputCacheWriteTokens}, 0) * coalesce(cost_lookup.input_cache_write, 0) / 1000000.0`,
	output: sql<number>`coalesce(${s.chatMessage.outputTotalTokens}, 0) * coalesce(cost_lookup.output, 0) / 1000000.0`,
};

export const TOTAL_COST_EXPR = sql<number>`${COST_EXPR.inputNoCache} + ${COST_EXPR.inputCacheRead} + ${COST_EXPR.inputCacheWrite} + ${COST_EXPR.output}`;

export async function createCostLookup(projectId: string) {
	const table = await buildCostValuesTable(projectId);
	const joinCondition = sql`cost_lookup.provider = ${s.chatMessage.llmProvider} AND cost_lookup.model_id = ${s.chatMessage.llmModelId}`;
	return { table, joinCondition };
}

export const getMessagesUsage = async (projectId: string, filter: UsageFilter): Promise<UsageRecord[]> => {
	const { granularity, provider } = filter;
	const dateExpr = getDateExpr(s.chatMessage.createdAt, granularity);
	const lookbackTs = getLookbackTimestamp(granularity);
	const lookbackFilter =
		dbConfig.dialect === Dialect.Postgres
			? sql`${s.chatMessage.createdAt} >= ${new Date(lookbackTs).toISOString()}`
			: sql`${s.chatMessage.createdAt} >= ${lookbackTs}`;

	const whereConditions = [eq(s.chat.projectId, projectId), lookbackFilter];
	if (provider) {
		whereConditions.push(eq(s.chatMessage.llmProvider, provider));
	}

	const costLookup = await createCostLookup(projectId);

	const rows = await db
		.select({
			date: dateExpr,
			messageCount: sql<number>`count(distinct case when ${s.chatMessage.role} = 'user' then ${s.chatMessage.id} end)`,
			webMessageCount: sql<number>`count(distinct case when ${s.chatMessage.role} = 'user' and ${s.chatMessage.source} = 'web' then ${s.chatMessage.id} end)`,
			slackMessageCount: sql<number>`count(distinct case when ${s.chatMessage.role} = 'user' and ${s.chatMessage.source} = 'slack' then ${s.chatMessage.id} end)`,
			teamsMessageCount: sql<number>`count(distinct case when ${s.chatMessage.role} = 'user' and ${s.chatMessage.source} = 'teams' then ${s.chatMessage.id} end)`,
			telegramMessageCount: sql<number>`count(distinct case when ${s.chatMessage.role} = 'user' and ${s.chatMessage.source} = 'telegram' then ${s.chatMessage.id} end)`,
			whatsappMessageCount: sql<number>`count(distinct case when ${s.chatMessage.role} = 'user' and ${s.chatMessage.source} = 'whatsapp' then ${s.chatMessage.id} end)`,
			inputNoCacheTokens: sum(s.chatMessage.inputNoCacheTokens),
			inputCacheReadTokens: sum(s.chatMessage.inputCacheReadTokens),
			inputCacheWriteTokens: sum(s.chatMessage.inputCacheWriteTokens),
			outputTotalTokens: sum(s.chatMessage.outputTotalTokens),
			totalTokens: sum(s.chatMessage.totalTokens),
			inputNoCacheCost: sql<number>`sum(${COST_EXPR.inputNoCache})`,
			inputCacheReadCost: sql<number>`sum(${COST_EXPR.inputCacheRead})`,
			inputCacheWriteCost: sql<number>`sum(${COST_EXPR.inputCacheWrite})`,
			outputCost: sql<number>`sum(${COST_EXPR.output})`,
		})
		.from(s.chatMessage)
		.innerJoin(s.chat, eq(s.chatMessage.chatId, s.chat.id))
		.leftJoin(costLookup.table, costLookup.joinCondition)
		.where(and(...whereConditions))
		.groupBy(dateExpr);

	return fillMissingDates(
		rows.map((row) => ({
			date: row.date,
			messageCount: row.messageCount,
			webMessageCount: row.webMessageCount,
			slackMessageCount: row.slackMessageCount,
			teamsMessageCount: row.teamsMessageCount,
			telegramMessageCount: row.telegramMessageCount,
			whatsappMessageCount: row.whatsappMessageCount,
			inputNoCacheTokens: Number(row.inputNoCacheTokens ?? 0),
			inputCacheReadTokens: Number(row.inputCacheReadTokens ?? 0),
			inputCacheWriteTokens: Number(row.inputCacheWriteTokens ?? 0),
			outputTotalTokens: Number(row.outputTotalTokens ?? 0),
			totalTokens: Number(row.totalTokens ?? 0),
			inputNoCacheCost: Number(row.inputNoCacheCost ?? 0),
			inputCacheReadCost: Number(row.inputCacheReadCost ?? 0),
			inputCacheWriteCost: Number(row.inputCacheWriteCost ?? 0),
			outputCost: Number(row.outputCost ?? 0),
			totalCost:
				Number(row.inputNoCacheCost ?? 0) +
				Number(row.inputCacheReadCost ?? 0) +
				Number(row.inputCacheWriteCost ?? 0) +
				Number(row.outputCost ?? 0),
		})),
		granularity,
	);
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

function getDateExpr(field: SQLWrapper, granularity: Granularity): SQL<string> {
	if (dbConfig.dialect === Dialect.Postgres) {
		const format = sql.raw(`'${pgFormats[granularity]}'`);
		return sql<string>`to_char(${field}, ${format})`;
	} else {
		const format = sql.raw(`'${sqliteFormats[granularity]}'`);
		return sql<string>`strftime(${format}, ${field} / 1000, 'unixepoch')`;
	}
}

/** Build a SQL values table with cost-per-million for each (provider, modelId). */
async function buildCostValuesTable(projectId: string): Promise<SQL> {
	const tuples = await getCostLookupTuples(projectId);

	if (dbConfig.dialect === Dialect.Postgres) {
		const rows = tuples.map(tupleToValuesRow);
		return sql`(VALUES ${sql.join(rows, sql`, `)}) AS cost_lookup(${sql.raw(COST_COLS.join(', '))})`;
	} else {
		const [first, ...rest] = tuples;
		const firstRow = tupleToSelectRow(first, true);
		const restRows = rest.map((t) => tupleToSelectRow(t, false));
		return sql`(${sql.join([firstRow, ...restRows], sql` UNION ALL `)}) AS cost_lookup`;
	}
}

async function getCostLookupTuples(projectId: string): Promise<CostLookupTuple[]> {
	const knownModelTuples = Object.entries(LLM_PROVIDERS).flatMap(([provider, config]) =>
		config.models.map((model) => {
			const cost = model.costPerM ?? {};
			return [
				provider,
				model.id,
				cost.inputNoCache ?? 0,
				cost.inputCacheRead ?? 0,
				cost.inputCacheWrite ?? 0,
				cost.output ?? 0,
			] satisfies CostLookupTuple;
		}),
	);

	const configs = await projectLlmConfigQueries.getProjectLlmConfigs(projectId);
	const customModelTuples = configs.flatMap((config) =>
		(config.customModels ?? []).map((model) => {
			const cost = model.costPerM ?? {};
			return [
				config.provider,
				model.id,
				cost.inputNoCache ?? 0,
				cost.inputCacheRead ?? 0,
				cost.inputCacheWrite ?? 0,
				cost.output ?? 0,
			] satisfies CostLookupTuple;
		}),
	);

	return [...knownModelTuples, ...customModelTuples];
}

function tupleToValuesRow(tuple: CostLookupTuple): SQL {
	return sql`(${tuple[0]}::text, ${tuple[1]}::text, ${tuple[2]}::double precision, ${tuple[3]}::double precision, ${tuple[4]}::double precision, ${tuple[5]}::double precision)`;
}

function tupleToSelectRow(tuple: CostLookupTuple, withAliases: boolean): SQL {
	if (!withAliases) {
		return sql`SELECT ${tuple[0]}, ${tuple[1]}, ${tuple[2]}, ${tuple[3]}, ${tuple[4]}, ${tuple[5]}`;
	}

	return sql`SELECT ${tuple[0]} AS provider, ${tuple[1]} AS model_id, ${tuple[2]} AS input_no_cache, ${tuple[3]} AS input_cache_read, ${tuple[4]} AS input_cache_write, ${tuple[5]} AS output`;
}
