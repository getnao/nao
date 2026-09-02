import { LlmProviderKind } from '@nao/shared/types';
import { z } from 'zod/v4';

import { PROVIDER_META } from '../agents/provider-meta';
import * as budgetQueries from '../queries/budget.queries';
import { hasFeature, LICENSE_FEATURES } from '../services/license.service';
import { setBudgetsInputSchema } from '../types/budget';
import { llmProviderSchema } from '../types/llm';
import { checkBudgetStatus, getEffectiveProviderBudgets } from '../utils/budget';
import { getProjectConfigLlm } from '../utils/llm';
import { adminProtectedProcedure, projectProtectedProcedure } from './trpc';

export const budgetRoutes = {
	getProvidersCostSupport: projectProtectedProcedure.query(async () => {
		return Object.fromEntries(
			Object.entries(PROVIDER_META).map(([provider, meta]) => [
				provider,
				meta.models.some((m) => m.costPerM !== undefined),
			]),
		) as Record<LlmProviderKind, boolean>;
	}),

	getBudgets: projectProtectedProcedure.query(async ({ ctx }) => {
		await budgetQueries.advanceStaleBudgetPeriods(ctx.project.id);
		return getEffectiveProviderBudgets(ctx.project.id);
	}),

	getProviderCosts: projectProtectedProcedure.query(async ({ ctx }) => {
		const budgets = await getEffectiveProviderBudgets(ctx.project.id);
		return budgetQueries.getProviderPeriodCosts(ctx.project.id, budgets);
	}),

	getPerUserProviderCosts: adminProtectedProcedure.query(async ({ ctx }) => {
		if (!(await hasFeature(LICENSE_FEATURES.userBudget))) {
			return {};
		}
		const budgets = (await getEffectiveProviderBudgets(ctx.project.id)).filter((b) => (b.perUserLimitUsd ?? 0) > 0);
		return budgetQueries.getProviderPeriodCostsByUser(ctx.project.id, budgets);
	}),

	checkBudgetStatus: projectProtectedProcedure
		.input(z.object({ provider: llmProviderSchema }))
		.query(async ({ ctx, input }) => {
			return checkBudgetStatus(ctx.project.id, input.provider, ctx.user.id);
		}),

	setBudgets: adminProtectedProcedure.input(setBudgetsInputSchema).mutation(async ({ ctx, input }) => {
		const configLlm = await getProjectConfigLlm(ctx.project.id);
		const configManaged = new Set((configLlm?.providers ?? []).filter((p) => p.budget).map((p) => p.provider));
		const editable = input.budgets.filter((b) => !configManaged.has(b.provider));

		const userBudgetEnabled = await hasFeature(LICENSE_FEATURES.userBudget);
		const budgets = userBudgetEnabled
			? editable
			: editable.map(({ provider, limitUsd, period }) => ({ provider, limitUsd, period }));
		return budgetQueries.setProjectProviderBudgets(ctx.project.id, budgets, [...configManaged]);
	}),
};
