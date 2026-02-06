import * as usageQueries from '../queries/usage.queries';
import { usageFilterSchema } from '../types/usage';
import { adminProtectedProcedure } from './trpc';

export const usageRoutes = {
	getMessagesUsage: adminProtectedProcedure.input(usageFilterSchema).query(async ({ ctx, input }) => {
		return usageQueries.getMessagesUsage(ctx.project.id, input);
	}),

	getUsedProviders: adminProtectedProcedure.query(async ({ ctx }) => {
		return usageQueries.getUsedProviders(ctx.project.id);
	}),
};
