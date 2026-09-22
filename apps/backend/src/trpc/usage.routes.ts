import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as usageQueries from '../queries/usage.queries';
import {
	assertSavedPeriodExists,
	getAndRepairPeriodSettings,
	mutatePeriodSettings,
} from '../services/usage-period-settings.service';
import {
	DEFAULT_USAGE_PERIOD_SELECTION,
	MAX_SAVED_USAGE_PERIODS,
	SAVED_USAGE_PERIOD_LIMIT_MESSAGE,
	savedUsagePeriodInputSchema,
	savedUsagePeriodSchema,
	usageChartFilterSchema,
	usageFilterSchema,
	usagePeriodSelectionSchema,
} from '../types/usage';
import { adminProtectedProcedure } from './trpc';

const projectPreferenceInputSchema = z.object({ projectId: z.string().min(1) });
const usagePeriodPreferenceProcedure = adminProtectedProcedure
	.input(projectPreferenceInputSchema)
	.use(async ({ ctx, input, next }) => {
		assertPreferenceProject(input.projectId, ctx.project.id);
		return next();
	});
const createSavedPeriodInputSchema = z.object({
	savedPeriod: savedUsagePeriodInputSchema,
});
const updateSavedPeriodInputSchema = z.object({
	savedPeriod: savedUsagePeriodSchema,
});
const deleteSavedPeriodInputSchema = z.object({
	id: savedUsagePeriodSchema.shape.id,
});

export const usageRoutes = {
	getMessagesUsage: adminProtectedProcedure.input(usageChartFilterSchema).query(async ({ ctx, input }) => {
		return usageQueries.getMessagesUsage(ctx.project.id, input);
	}),

	getTotalUsage: adminProtectedProcedure.input(usageFilterSchema).query(async ({ ctx, input }) => {
		return usageQueries.getTotalUsage(ctx.project.id, input);
	}),

	getUsedProviders: adminProtectedProcedure.query(async ({ ctx }) => {
		return usageQueries.getUsedProviders(ctx.project.id);
	}),

	getPeriodSettings: usagePeriodPreferenceProcedure.query(async ({ ctx }) => {
		const { preferences, savedPeriods } = await getAndRepairPeriodSettings(ctx.user.id, ctx.project.id);
		return {
			selection: preferences.usagePeriod ?? null,
			savedPeriods,
		};
	}),

	updatePeriodSelection: usagePeriodPreferenceProcedure
		.input(z.object({ selection: usagePeriodSelectionSchema }))
		.mutation(async ({ ctx, input }) => {
			const preferences = await mutatePeriodSettings(
				ctx.user.id,
				ctx.project.id,
				({ preferences: current, savedPeriods }) => {
					if (input.selection.mode === 'saved') {
						assertSavedPeriodExists(savedPeriods, input.selection.savedPeriodId);
					}
					return { ...current, usagePeriod: input.selection };
				},
			);
			return preferences.usagePeriod;
		}),

	createSavedPeriod: usagePeriodPreferenceProcedure
		.input(createSavedPeriodInputSchema)
		.mutation(async ({ ctx, input }) => {
			const savedPeriod = { id: crypto.randomUUID(), ...input.savedPeriod };
			await mutatePeriodSettings(ctx.user.id, ctx.project.id, ({ preferences: current, savedPeriods }) => {
				if (savedPeriods.length >= MAX_SAVED_USAGE_PERIODS) {
					throw new TRPCError({ code: 'BAD_REQUEST', message: SAVED_USAGE_PERIOD_LIMIT_MESSAGE });
				}
				return {
					...current,
					usagePeriod: { mode: 'saved', savedPeriodId: savedPeriod.id },
					savedUsagePeriods: [...savedPeriods, savedPeriod],
				};
			});
			return savedPeriod;
		}),

	updateSavedPeriod: usagePeriodPreferenceProcedure
		.input(updateSavedPeriodInputSchema)
		.mutation(async ({ ctx, input }) => {
			const nextSavedPeriod = input.savedPeriod;
			await mutatePeriodSettings(ctx.user.id, ctx.project.id, ({ preferences: current, savedPeriods }) => {
				assertSavedPeriodExists(savedPeriods, nextSavedPeriod.id);
				return {
					...current,
					savedUsagePeriods: savedPeriods.map((savedPeriod) =>
						savedPeriod.id === nextSavedPeriod.id ? nextSavedPeriod : savedPeriod,
					),
				};
			});
			return nextSavedPeriod;
		}),

	deleteSavedPeriod: usagePeriodPreferenceProcedure
		.input(deleteSavedPeriodInputSchema)
		.mutation(async ({ ctx, input }) => {
			const preferences = await mutatePeriodSettings(
				ctx.user.id,
				ctx.project.id,
				({ preferences: current, savedPeriods }) => {
					assertSavedPeriodExists(savedPeriods, input.id);
					const usagePeriod =
						current.usagePeriod?.mode === 'saved' && current.usagePeriod.savedPeriodId === input.id
							? DEFAULT_USAGE_PERIOD_SELECTION
							: current.usagePeriod;
					return {
						...current,
						usagePeriod,
						savedUsagePeriods: savedPeriods.filter(({ id }) => id !== input.id),
					};
				},
			);
			return { id: input.id, selection: preferences.usagePeriod };
		}),
};

function assertPreferenceProject(inputProjectId: string, contextProjectId: string): void {
	if (inputProjectId !== contextProjectId) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Active project changed. Retry the request.' });
	}
}
