import { getCurrentPeriodStart } from '@nao/shared/date';
import type { LlmProvider } from '@nao/shared/types';
import { and, eq, notInArray, sql } from 'drizzle-orm';

import s, { DBProjectProviderBudget } from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import type { BudgetPeriod } from '../types/budget';
import { createCostLookup, TOTAL_COST_EXPR } from './usage.queries';

export const getProviderBudget = async (
	projectId: string,
	provider: LlmProvider,
): Promise<DBProjectProviderBudget | null> => {
	const [row] = await db
		.select()
		.from(s.projectProviderBudget)
		.where(and(eq(s.projectProviderBudget.projectId, projectId), eq(s.projectProviderBudget.provider, provider)))
		.execute();
	return row ?? null;
};

export const getProviderCurrentSpend = async (projectId: string, provider: LlmProvider): Promise<number> => {
	const costs = await getProviderPeriodCosts(projectId, provider);
	return costs[provider] ?? 0;
};

export const getProjectProviderBudgets = async (projectId: string): Promise<DBProjectProviderBudget[]> => {
	return db.select().from(s.projectProviderBudget).where(eq(s.projectProviderBudget.projectId, projectId)).execute();
};

export const advanceStaleBudgetPeriods = async (projectId: string, provider?: LlmProvider): Promise<void> => {
	const budgets = provider
		? await getProviderBudget(projectId, provider).then((b) => (b ? [b] : []))
		: await getProjectProviderBudgets(projectId);

	for (const budget of budgets) {
		if (budget.limitUsd <= 0) {
			continue;
		}
		const expectedPeriodStart = getCurrentPeriodStart(budget.period as BudgetPeriod);
		if (expectedPeriodStart.getTime() > budget.currentPeriodStart.getTime()) {
			await db
				.update(s.projectProviderBudget)
				.set({ currentPeriodStart: expectedPeriodStart })
				.where(eq(s.projectProviderBudget.id, budget.id))
				.execute();
		}
	}
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

export const setProjectProviderBudgets = async (
	projectId: string,
	budgets: Array<{ provider: LlmProvider; limitUsd: number; period: BudgetPeriod }>,
): Promise<DBProjectProviderBudget[]> => {
	const activeProviders = budgets.map((b) => b.provider);

	return db.transaction(async (tx) => {
		const deleteConditions = [eq(s.projectProviderBudget.projectId, projectId)];
		if (activeProviders.length > 0) {
			deleteConditions.push(notInArray(s.projectProviderBudget.provider, activeProviders));
		}
		await tx
			.delete(s.projectProviderBudget)
			.where(and(...deleteConditions))
			.execute();

		const results = await Promise.all(
			budgets.map(async ({ provider, limitUsd, period }) => {
				const [existing] = await tx
					.select()
					.from(s.projectProviderBudget)
					.where(
						and(
							eq(s.projectProviderBudget.projectId, projectId),
							eq(s.projectProviderBudget.provider, provider),
						),
					)
					.execute();

				if (existing) {
					const periodChanged = existing.period !== period;
					const [updated] = await tx
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

				const [created] = await tx
					.insert(s.projectProviderBudget)
					.values({ projectId, provider, limitUsd, period })
					.returning()
					.execute();
				return created;
			}),
		);

		return results;
	});
};

export const getProviderPeriodCosts = async (
	projectId: string,
	provider?: LlmProvider,
): Promise<Record<string, number>> => {
	const costLookup = createCostLookup();
	const isPostgres = dbConfig.dialect === Dialect.Postgres;
	const dayStart = getCurrentPeriodStart('day');
	const weekStart = getCurrentPeriodStart('week');
	const monthStart = getCurrentPeriodStart('month');

	const toParam = (d: Date) => (isPostgres ? d.toISOString() : d.getTime());
	const periodStartExpr = sql`CASE ${s.projectProviderBudget.period}
		WHEN 'day' THEN ${toParam(dayStart)}
		WHEN 'week' THEN ${toParam(weekStart)}
		WHEN 'month' THEN ${toParam(monthStart)}
	END`;

	const rows = await db
		.select({
			provider: s.projectProviderBudget.provider,
			totalCost: sql<number>`sum(${TOTAL_COST_EXPR})`,
		})
		.from(s.projectProviderBudget)
		.innerJoin(s.chat, eq(s.chat.projectId, s.projectProviderBudget.projectId))
		.innerJoin(s.chatMessage, eq(s.chatMessage.chatId, s.chat.id))
		.leftJoin(costLookup.table, costLookup.joinCondition)
		.where(
			and(
				eq(s.projectProviderBudget.projectId, projectId),
				sql`${s.chatMessage.llmProvider} = ${s.projectProviderBudget.provider}`,
				sql`${s.chatMessage.createdAt} >= ${periodStartExpr}`,
				provider ? eq(s.projectProviderBudget.provider, provider) : undefined,
			),
		)
		.groupBy(s.projectProviderBudget.provider);

	const result: Record<string, number> = {};
	for (const row of rows) {
		result[row.provider] = Math.round(Number(row.totalCost ?? 0) * 100) / 100;
	}
	return result;
};

export const claimBudgetNotification = async (budget: DBProjectProviderBudget): Promise<boolean> => {
	const notifiedCondition = budget.notifiedAt
		? sql`${s.projectProviderBudget.notifiedAt} = ${budget.notifiedAt}`
		: sql`${s.projectProviderBudget.notifiedAt} IS NULL`;

	const rows = await db
		.update(s.projectProviderBudget)
		.set({ notifiedAt: new Date() })
		.where(and(eq(s.projectProviderBudget.id, budget.id), notifiedCondition))
		.returning({ id: s.projectProviderBudget.id })
		.execute();

	return rows.length > 0;
};

export const rollbackBudgetNotification = async (budget: DBProjectProviderBudget): Promise<void> => {
	await db
		.update(s.projectProviderBudget)
		.set({ notifiedAt: budget.notifiedAt })
		.where(eq(s.projectProviderBudget.id, budget.id))
		.execute();
};
