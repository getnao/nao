import type { LlmProvider } from '@nao/shared/types';
import { and, eq, isNotNull, or, SQL, sql, SQLWrapper, sum } from 'drizzle-orm';

import { LLM_PROVIDERS } from '../agents/providers';
import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import type { ModelCosts } from '../types/llm';
import type { Granularity, TotalUsageRecord, UsageFilter, UsageRecord, UsageSource } from '../types/usage';
import { fillMissingDates, getLookbackTimestamp } from '../utils/date';
import { getProjectDeclaredModels } from '../utils/llm';

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

const MESSAGE_USAGE_PROVIDER_EXPR = sql<LlmProvider | null>`case
	when ${s.chatMessage.role} = 'user' then (
		select next_message.llm_provider
		from chat_message as next_message
		where next_message.chat_id = ${s.chatMessage.chatId}
			and next_message.role = 'assistant'
			and next_message.llm_provider is not null
			and next_message.created_at > ${s.chatMessage.createdAt}
			and not exists (
				select 1
				from chat_message as next_user_message
				where next_user_message.chat_id = ${s.chatMessage.chatId}
					and next_user_message.role = 'user'
					and next_user_message.created_at > ${s.chatMessage.createdAt}
					and next_user_message.created_at < next_message.created_at
			)
		order by next_message.created_at asc
		limit 1
	)
	else ${s.chatMessage.llmProvider}
end`;

const MESSAGE_USAGE_SOURCE_EXPR = sql<UsageSource | null>`case
	when ${s.chatMessage.role} = 'assistant' then (
		select source_message.source
		from chat_message as source_message
		where source_message.chat_id = ${s.chatMessage.chatId}
			and source_message.role = 'user'
			and source_message.created_at <= ${s.chatMessage.createdAt}
		order by source_message.created_at desc
		limit 1
	)
	else ${s.chatMessage.source}
end`;

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
		whereConditions.push(sql`${MESSAGE_USAGE_PROVIDER_EXPR} = ${provider}`);
	}
	addUserNameFilter(whereConditions, filter.userNames);
	addSourceFilter(whereConditions, filter.sources);

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
			adminMessageCount: sql<number>`count(distinct case when ${s.chatMessage.role} = 'user' and ${s.chatMessage.source} = 'admin' then ${s.chatMessage.id} end)`,
			mcpMessageCount: sql<number>`count(distinct case when ${s.chatMessage.role} = 'user' and ${s.chatMessage.source} = 'mcp' then ${s.chatMessage.id} end)`,
			contextRecommendationsMessageCount: sql<number>`count(distinct case when ${s.chatMessage.role} = 'user' and ${s.chatMessage.source} = 'contextRecommendations' then ${s.chatMessage.id} end)`,
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
		.innerJoin(s.user, eq(s.chat.userId, s.user.id))
		.leftJoin(costLookup.table, costLookup.joinCondition)
		.where(and(...whereConditions))
		.groupBy(dateExpr);

	return fillMissingDates(
		rows.map((row) => ({
			date: row.date,
			messageCount: Number(row.messageCount ?? 0),
			webMessageCount: Number(row.webMessageCount ?? 0),
			slackMessageCount: Number(row.slackMessageCount ?? 0),
			teamsMessageCount: Number(row.teamsMessageCount ?? 0),
			telegramMessageCount: Number(row.telegramMessageCount ?? 0),
			whatsappMessageCount: Number(row.whatsappMessageCount ?? 0),
			adminMessageCount: Number(row.adminMessageCount ?? 0),
			mcpMessageCount: Number(row.mcpMessageCount ?? 0),
			contextRecommendationsMessageCount: Number(row.contextRecommendationsMessageCount ?? 0),
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

export const getTotalUsage = async (projectId: string, filter: UsageFilter): Promise<TotalUsageRecord> => {
	const { granularity, provider } = filter;
	const lookbackTs = getLookbackTimestamp(granularity);
	const lookbackFilter =
		dbConfig.dialect === Dialect.Postgres
			? sql`${s.chatMessage.createdAt} >= ${new Date(lookbackTs).toISOString()}`
			: sql`${s.chatMessage.createdAt} >= ${lookbackTs}`;

	const whereConditions = [eq(s.chat.projectId, projectId), lookbackFilter];
	if (provider) {
		whereConditions.push(sql`${MESSAGE_USAGE_PROVIDER_EXPR} = ${provider}`);
	}
	addUserNameFilter(whereConditions, filter.userNames);
	addSourceFilter(whereConditions, filter.sources);

	const rows = await db
		.select({
			totalMessages: sql<number>`count(distinct case when ${s.chatMessage.role} = 'user' then ${s.chatMessage.id} end)`,
			uniqueUsers: sql<number>`count(distinct ${s.chat.userId})`,
		})
		.from(s.chatMessage)
		.innerJoin(s.chat, eq(s.chatMessage.chatId, s.chat.id))
		.innerJoin(s.user, eq(s.chat.userId, s.user.id))
		.where(and(...whereConditions));

	return {
		totalMessages: Number(rows[0]?.totalMessages ?? 0),
		uniqueUsers: Number(rows[0]?.uniqueUsers ?? 0),
	};
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

function addUserNameFilter(whereConditions: SQL<unknown>[], userNames: string[] | undefined) {
	const names = userNames?.filter(Boolean) ?? [];
	if (names.length === 0) {
		return;
	}

	const expr = or(...names.map((name) => eq(s.user.name, name)));
	if (expr) {
		whereConditions.push(expr);
	}
}

function addSourceFilter(whereConditions: SQL<unknown>[], sources: UsageSource[] | undefined) {
	if (!sources?.length) {
		return;
	}

	const expr = or(...sources.map((source) => eq(MESSAGE_USAGE_SOURCE_EXPR, source)));
	if (expr) {
		whereConditions.push(expr);
	}
}

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
	const costs = new Map<string, ModelCosts>();

	for (const [provider, config] of Object.entries(LLM_PROVIDERS)) {
		for (const model of config.models) {
			costs.set(`${provider}\u0000${model.id}`, { ...model.costPerM });
		}
	}

	for (const { provider, models } of await getProjectDeclaredModels(projectId)) {
		for (const model of models) {
			const key = `${provider}\u0000${model.id}`;
			costs.set(key, { ...costs.get(key), ...model.costPerM });
		}
	}

	return [...costs].map(([key, cost]) => {
		const [provider, modelId] = key.split('\u0000');
		return [
			provider,
			modelId,
			cost.inputNoCache ?? 0,
			cost.inputCacheRead ?? 0,
			cost.inputCacheWrite ?? 0,
			cost.output ?? 0,
		] satisfies CostLookupTuple;
	});
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
