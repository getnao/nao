import { BUDGET_PERIODS, MAX_BUDGET_LIMIT_USD } from '@nao/shared/types';
import { z } from 'zod/v4';

import { llmProviderSchema } from './llm';

export const budgetPeriodSchema = z.enum(BUDGET_PERIODS);
export type BudgetPeriod = z.infer<typeof budgetPeriodSchema>;

export const budgetEntrySchema = z.object({
	provider: llmProviderSchema,
	limitUsd: z.int().min(0).max(MAX_BUDGET_LIMIT_USD),
	period: budgetPeriodSchema,
});

export const setBudgetsInputSchema = z.object({
	budgets: z.array(budgetEntrySchema),
});
export type SetBudgetsInput = z.infer<typeof setBudgetsInputSchema>;
