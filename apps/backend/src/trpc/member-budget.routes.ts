/* @license Enterprise */

import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as projectQueries from '../queries/project.queries';
import {
	getMemberBudget,
	getMemberBudgetOverview,
	getMemberBudgetSettings,
	getMemberSpendForPeriod,
	saveMemberBudgets,
	setPersonalBudget,
} from '../services/member-budget.service';
import {
	memberBudgetPeriodInputSchema,
	setMemberBudgetsInputSchema,
	setPersonalBudgetInputSchema,
} from '../types/member-budget';
import { assertMemberBudgetLicensed } from '../utils/member-budget';
import { adminProtectedProcedure, projectProtectedProcedure } from './trpc';

export const memberBudgetRoutes = {
	getOverview: adminProtectedProcedure.query(async ({ ctx }) => {
		await assertMemberBudgetLicensed();
		return getMemberBudgetOverview(ctx.project.id);
	}),

	getSpend: adminProtectedProcedure.input(memberBudgetPeriodInputSchema).query(async ({ ctx, input }) => {
		await assertMemberBudgetLicensed();
		return getMemberSpendForPeriod(ctx.project.id, input.period);
	}),

	getSettings: adminProtectedProcedure.query(async ({ ctx }) => {
		await assertMemberBudgetLicensed();
		return getMemberBudgetSettings(ctx.project.id);
	}),

	getMine: projectProtectedProcedure.query(async ({ ctx }) => {
		await assertMemberBudgetLicensed();
		return getMemberBudget(ctx.project.id, ctx.user.id);
	}),

	getForMember: adminProtectedProcedure
		.input(z.object({ userId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			await assertMemberBudgetLicensed();
			await assertProjectMember(ctx.project.id, input.userId);
			return getMemberBudget(ctx.project.id, input.userId);
		}),

	setPersonalBudget: adminProtectedProcedure.input(setPersonalBudgetInputSchema).mutation(async ({ ctx, input }) => {
		await assertMemberBudgetLicensed();
		await assertProjectMember(ctx.project.id, input.userId);
		await setPersonalBudget(ctx.project.id, input);
	}),

	setBudgets: adminProtectedProcedure.input(setMemberBudgetsInputSchema).mutation(async ({ ctx, input }) => {
		await assertMemberBudgetLicensed();
		await saveMemberBudgets(ctx.project.id, input);
		return getMemberBudgetOverview(ctx.project.id);
	}),
};

async function assertProjectMember(projectId: string, userId: string): Promise<void> {
	if (!(await projectQueries.getUserRoleInProject(projectId, userId))) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'This user does not have access to the project.' });
	}
}
