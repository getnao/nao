import { LlmProvider } from '@nao/shared/types';

import { PROVIDER_META } from '../agents/provider-meta';
import * as budgetQueries from '../queries/budget.queries';
import { setBudgetsInputSchema } from '../types/budget';
import { adminProtectedProcedure, projectProtectedProcedure } from './trpc';

export const budgetRoutes = {
	getProvidersCostSupport: projectProtectedProcedure.query(async () => {
		return Object.fromEntries(
			Object.entries(PROVIDER_META).map(([provider, meta]) => [
				provider,
				meta.models.some((m) => m.costPerM !== undefined),
			]),
		) as Record<LlmProvider, boolean>;
	}),

	getBudgets: projectProtectedProcedure.query(async ({ ctx }) => {
		return budgetQueries.getProjectProviderBudgets(ctx.project.id);
	}),

	setBudgets: adminProtectedProcedure.input(setBudgetsInputSchema).mutation(async ({ ctx, input }) => {
		const activeProviders = input.budgets.map((b) => b.provider);

		await budgetQueries.deleteProjectProviderBudgets(ctx.project.id, activeProviders);

		const results = await Promise.all(
			input.budgets.map((b) =>
				budgetQueries.upsertProjectProviderBudget(ctx.project.id, b.provider, b.limitUsd, b.period),
			),
		);

		return results;
	}),
};
