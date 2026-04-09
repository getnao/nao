import type { LlmProvider } from '@nao/shared/types';
import { and, eq, notInArray, sql } from 'drizzle-orm';

import s, { DBProjectProviderBudget } from '../db/abstractSchema';
import { db } from '../db/db';
import type { BudgetPeriod } from '../types/budget';
import { buildCostValuesTable } from './usage.queries';

export const getProjectProviderBudgets = async (projectId: string): Promise<DBProjectProviderBudget[]> => {
	return db.select().from(s.projectProviderBudget).where(eq(s.projectProviderBudget.projectId, projectId)).execute();
};

export const upsertProjectProviderBudget = async (
	projectId: string,
	provider: LlmProvider,
	limitUsd: number,
	period: BudgetPeriod,
): Promise<DBProjectProviderBudget> => {
	const existing = await db
		.select()
		.from(s.projectProviderBudget)
		.where(and(eq(s.projectProviderBudget.projectId, projectId), eq(s.projectProviderBudget.provider, provider)))
		.execute()
		.then((rows) => rows[0] ?? null);

	if (existing) {
		const periodChanged = existing.period !== period;
		const [updated] = await db
			.update(s.projectProviderBudget)
			.set({
				limitUsd,
				period,
				...(periodChanged && { currentPeriodStart: new Date() }),
			})
			.where(eq(s.projectProviderBudget.id, existing.id))
			.returning()
			.execute();
		return updated;
	}

	const [created] = await db
		.insert(s.projectProviderBudget)
		.values({ projectId, provider, limitUsd, period })
		.returning()
		.execute();
	return created;
};

export const deleteProjectProviderBudgets = async (
	projectId: string,
	activeProviders: LlmProvider[],
): Promise<void> => {
	if (activeProviders.length === 0) {
		return;
	}
	await db
		.delete(s.projectProviderBudget)
		.where(
			and(
				eq(s.projectProviderBudget.projectId, projectId),
				notInArray(s.projectProviderBudget.provider, activeProviders),
			),
		)
		.execute();
};

export const getProviderPeriodCosts = async (projectId: string): Promise<Record<string, number>> => {
	const costLookup = buildCostValuesTable();

	const rows = await db
		.select({
			provider: s.projectProviderBudget.provider,
			totalCost: sql<number>`sum(
				coalesce(${s.chatMessage.inputNoCacheTokens}, 0) * coalesce(cost_lookup.input_no_cache, 0) / 1000000.0 +
				coalesce(${s.chatMessage.inputCacheReadTokens}, 0) * coalesce(cost_lookup.input_cache_read, 0) / 1000000.0 +
				coalesce(${s.chatMessage.inputCacheWriteTokens}, 0) * coalesce(cost_lookup.input_cache_write, 0) / 1000000.0 +
				coalesce(${s.chatMessage.outputTotalTokens}, 0) * coalesce(cost_lookup.output, 0) / 1000000.0
			)`,
		})
		.from(s.projectProviderBudget)
		.innerJoin(s.chat, eq(s.chat.projectId, s.projectProviderBudget.projectId))
		.innerJoin(s.chatMessage, eq(s.chatMessage.chatId, s.chat.id))
		.leftJoin(
			costLookup,
			sql`cost_lookup.provider = ${s.chatMessage.llmProvider} AND cost_lookup.model_id = ${s.chatMessage.llmModelId}`,
		)
		.where(
			and(
				eq(s.projectProviderBudget.projectId, projectId),
				sql`${s.chatMessage.llmProvider} = ${s.projectProviderBudget.provider}`,
				sql`${s.chatMessage.createdAt} >= ${s.projectProviderBudget.currentPeriodStart}`,
			),
		)
		.groupBy(s.projectProviderBudget.provider);

	const result: Record<string, number> = {};
	for (const row of rows) {
		result[row.provider] = Math.round(Number(row.totalCost ?? 0) * 100) / 100;
	}
	return result;
};
