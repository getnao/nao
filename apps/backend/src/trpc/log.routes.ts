import * as logQueries from '../queries/log.queries';
import { logFilterSchema } from '../types/log';
import { adminProtectedProcedure } from './trpc';

export const logRoutes = {
	getLogs: adminProtectedProcedure.input(logFilterSchema).query(async ({ ctx, input }) => {
		return logQueries.getLogs(ctx.project.id, input);
	}),
};
