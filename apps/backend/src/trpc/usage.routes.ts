import * as usageQueries from '../queries/usage.queries';
import * as userProjectPreferenceQueries from '../queries/user-project-preference.queries';
import { usageFilterSchema, usagePeriodPreferenceSchema } from '../types/usage';
import { adminProtectedProcedure } from './trpc';

export const usageRoutes = {
	getMessagesUsage: adminProtectedProcedure.input(usageFilterSchema).query(async ({ ctx, input }) => {
		return usageQueries.getMessagesUsage(ctx.project.id, input);
	}),

	getTotalUsage: adminProtectedProcedure.input(usageFilterSchema).query(async ({ ctx, input }) => {
		return usageQueries.getTotalUsage(ctx.project.id, input);
	}),

	getUsedProviders: adminProtectedProcedure.query(async ({ ctx }) => {
		return usageQueries.getUsedProviders(ctx.project.id);
	}),

	getPeriodPreference: adminProtectedProcedure.query(async ({ ctx }) => {
		const preferences = await userProjectPreferenceQueries.getUserProjectPreferences(ctx.user.id, ctx.project.id);
		const parsedPreference = usagePeriodPreferenceSchema.safeParse(preferences.usagePeriod);
		return parsedPreference.success ? parsedPreference.data : null;
	}),

	updatePeriodPreference: adminProtectedProcedure
		.input(usagePeriodPreferenceSchema)
		.mutation(async ({ ctx, input }) => {
			const preferences = await userProjectPreferenceQueries.updateUserProjectPreferences(
				ctx.user.id,
				ctx.project.id,
				{ usagePeriod: input },
			);
			return preferences.usagePeriod;
		}),
};
