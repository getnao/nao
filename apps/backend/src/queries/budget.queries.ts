import { getCurrentPeriodStart } from '@nao/shared/date';
import type { LlmProvider } from '@nao/shared/types';
import { and, eq, notInArray, sql } from 'drizzle-orm';

import s, { DBProjectProviderBudget } from '../db/abstractSchema';
import { db } from '../db/db';
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

export const getProviderPeriodCosts = async (
	projectId: string,
	provider?: LlmProvider,
): Promise<Record<string, number>> => {
	const costLookup = createCostLookup();
	const dayStart = getCurrentPeriodStart('day').getTime();
	const weekStart = getCurrentPeriodStart('week').getTime();
	const monthStart = getCurrentPeriodStart('month').getTime();

	const periodStartExpr = sql`CASE ${s.projectProviderBudget.period}
		WHEN 'day' THEN ${dayStart}
		WHEN 'week' THEN ${weekStart}
		WHEN 'month' THEN ${monthStart}
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

export const markBudgetNotified = async (budgetId: string): Promise<void> => {
	await db
		.update(s.projectProviderBudget)
		.set({ notifiedAt: new Date() })
		.where(eq(s.projectProviderBudget.id, budgetId))
		.execute();
};
