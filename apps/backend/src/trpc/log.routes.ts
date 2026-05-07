import * as logQueries from '../queries/log.queries';
import { logFilterSchema } from '../types/log';
import { adminProtectedProcedure } from './trpc';

export const logRoutes = {
	listLogs: adminProtectedProcedure.input(logFilterSchema).query(async ({ ctx, input }) => {
		return logQueries.listLogs(ctx.project.id, input);
	}),
};
