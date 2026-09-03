import { getCurrentPeriodStart } from '@nao/shared/date';
import type { LlmProvider } from '@nao/shared/types';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';

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

export type ProviderPeriod = { provider: LlmProvider; period: BudgetPeriod };

export const getProviderBudgetSpend = async (
	projectId: string,
	provider: LlmProvider,
	period: BudgetPeriod,
	userId?: string,
): Promise<{ projectSpend: number; userSpend: number }> => {
	const rows = await queryProviderPeriodCosts(projectId, [{ provider, period }]);

	let projectTotal = 0;
	let userTotal = 0;
	for (const row of rows) {
		const cost = Number(row.totalCost ?? 0);
		projectTotal += cost;
		if (userId && row.userId === userId) {
			userTotal += cost;
		}
	}

	return { projectSpend: roundCost(projectTotal), userSpend: roundCost(userTotal) };
};

export const getProjectProviderBudgets = async (projectId: string): Promise<DBProjectProviderBudget[]> => {
	return db.select().from(s.projectProviderBudget).where(eq(s.projectProviderBudget.projectId, projectId)).execute();
};

export const advanceStaleBudgetPeriods = async (projectId: string, provider?: LlmProvider): Promise<void> => {
	const budgets = provider
		? await getProviderBudget(projectId, provider).then((b) => (b ? [b] : []))
		: await getProjectProviderBudgets(projectId);

	for (const budget of budgets) {
		if (budget.limitUsd <= 0 && !budget.perUserLimitUsd) {
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

export const setProjectProviderBudgets = async (
	projectId: string,
	budgets: Array<{ provider: LlmProvider; limitUsd: number; period: BudgetPeriod; perUserLimitUsd?: number | null }>,
	preserveProviders: LlmProvider[] = [],
): Promise<DBProjectProviderBudget[]> => {
	const activeProviders = budgets.map((b) => b.provider);
	const retainedProviders = [...activeProviders, ...preserveProviders];

	return db.transaction(async (tx) => {
		const deleteConditions = [eq(s.projectProviderBudget.projectId, projectId)];
		if (retainedProviders.length > 0) {
			deleteConditions.push(notInArray(s.projectProviderBudget.provider, retainedProviders));
		}
		await tx
			.delete(s.projectProviderBudget)
			.where(and(...deleteConditions))
			.execute();

		const results = await Promise.all(
			budgets.map(async ({ provider, limitUsd, period, perUserLimitUsd }) => {
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
							...(perUserLimitUsd !== undefined && { perUserLimitUsd }),
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
					.values({ projectId, provider, limitUsd, perUserLimitUsd: perUserLimitUsd ?? null, period })
					.returning()
					.execute();
				return created;
			}),
		);

		return results;
	});
};

type ProviderPeriodCostRow = { provider: LlmProvider | null; userId: string | null; totalCost: number };

const roundCost = (value: number): number => Math.round(value * 100) / 100;

const queryProviderPeriodCosts = async (
	projectId: string,
	budgets: ProviderPeriod[],
	options: { userId?: string } = {},
): Promise<ProviderPeriodCostRow[]> => {
	if (budgets.length === 0) {
		return [];
	}

	const costLookup = await createCostLookup(projectId);
	const isPostgres = dbConfig.dialect === Dialect.Postgres;

	const toParam = (d: Date) => (isPostgres ? sql`${d.toISOString()}::timestamp` : sql`${d.getTime()}`);
	const periodStartCases = budgets.map(
		(b) => sql`WHEN ${b.provider} THEN ${toParam(getCurrentPeriodStart(b.period))}`,
	);
	const periodStartExpr = sql`CASE ${s.chatMessage.llmProvider} ${sql.join(periodStartCases, sql` `)} END`;

	return db
		.select({
			provider: s.chatMessage.llmProvider,
			userId: s.chat.userId,
			totalCost: sql<number>`sum(${TOTAL_COST_EXPR})`,
		})
		.from(s.chatMessage)
		.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
		.leftJoin(costLookup.table, costLookup.joinCondition)
		.where(
			and(
				eq(s.chat.projectId, projectId),
				inArray(
					s.chatMessage.llmProvider,
					budgets.map((b) => b.provider),
				),
				sql`${s.chatMessage.createdAt} >= ${periodStartExpr}`,
				options.userId ? eq(s.chat.userId, options.userId) : undefined,
			),
		)
		.groupBy(s.chatMessage.llmProvider, s.chat.userId);
};

export const getProviderPeriodCosts = async (
	projectId: string,
	budgets: ProviderPeriod[],
): Promise<Record<string, number>> => {
	const rows = await queryProviderPeriodCosts(projectId, budgets);

	const totals: Record<string, number> = {};
	for (const row of rows) {
		if (!row.provider) {
			continue;
		}
		totals[row.provider] = (totals[row.provider] ?? 0) + Number(row.totalCost ?? 0);
	}

	const result: Record<string, number> = {};
	for (const [providerKey, total] of Object.entries(totals)) {
		result[providerKey] = roundCost(total);
	}
	return result;
};

export const getProviderPeriodCostsByUser = async (
	projectId: string,
	budgets: ProviderPeriod[],
): Promise<Record<string, Record<string, number>>> => {
	const rows = await queryProviderPeriodCosts(projectId, budgets);

	const result: Record<string, Record<string, number>> = {};
	for (const row of rows) {
		if (!row.provider || !row.userId) {
			continue;
		}
		const providerCosts = (result[row.provider] ??= {});
		providerCosts[row.userId] = roundCost(Number(row.totalCost ?? 0));
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
