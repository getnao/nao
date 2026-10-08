/* @license Enterprise */

import { MAX_BUDGET_LIMIT_USD, MEMBER_BUDGET_PERIODS } from '@nao/shared/types';
import { z } from 'zod/v4';

/** `null` clears the budget so the member or group falls back to the next budget in line. */
export const budgetLimitUsdSchema = z.int().min(0).max(MAX_BUDGET_LIMIT_USD).nullable();

const memberBudgetPeriodSchema = z.enum(MEMBER_BUDGET_PERIODS);

export const memberBudgetPeriodInputSchema = z.object({ period: memberBudgetPeriodSchema });

/** Only the personal and group budgets that changed are sent, so concurrent edits elsewhere are kept. */
export const setMemberBudgetsInputSchema = z.object({
	period: memberBudgetPeriodSchema,
	defaultLimitUsd: budgetLimitUsdSchema.unwrap(),
	personalBudgets: z.array(z.object({ userId: z.string().min(1), limitUsd: budgetLimitUsdSchema })),
	groupBudgets: z.array(z.object({ groupId: z.string().min(1), limitUsd: budgetLimitUsdSchema })),
});
export type SetMemberBudgetsInput = z.infer<typeof setMemberBudgetsInputSchema>;

export const setPersonalBudgetInputSchema = z.object({ userId: z.string().min(1), limitUsd: budgetLimitUsdSchema });
export type SetPersonalBudgetInput = z.infer<typeof setPersonalBudgetInputSchema>;
