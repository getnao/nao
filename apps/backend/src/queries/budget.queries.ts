import type { LlmProvider } from '@nao/shared/types';
import { and, eq, notInArray } from 'drizzle-orm';

import s, { DBProjectProviderBudget } from '../db/abstractSchema';
import { db } from '../db/db';
import type { BudgetPeriod } from '../types/budget';

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
