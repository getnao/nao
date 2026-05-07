import { LlmProvider } from '@nao/shared/types';
import { z } from 'zod/v4';

import { PROVIDER_META } from '../agents/provider-meta';
import * as budgetQueries from '../queries/budget.queries';
import { setBudgetsInputSchema } from '../types/budget';
import { llmProviderSchema } from '../types/llm';
import { checkBudgetStatus } from '../utils/budget';
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
		await budgetQueries.advanceStaleBudgetPeriods(ctx.project.id);
		return budgetQueries.getProjectProviderBudgets(ctx.project.id);
	}),

	getProviderCosts: projectProtectedProcedure.query(async ({ ctx }) => {
		return budgetQueries.getProviderPeriodCosts(ctx.project.id);
	}),

	checkBudgetStatus: projectProtectedProcedure
		.input(z.object({ provider: llmProviderSchema }))
		.query(async ({ ctx, input }) => {
			return checkBudgetStatus(ctx.project.id, input.provider);
		}),

	setBudgets: adminProtectedProcedure.input(setBudgetsInputSchema).mutation(async ({ ctx, input }) => {
		return budgetQueries.setProjectProviderBudgets(ctx.project.id, input.budgets);
	}),
};
