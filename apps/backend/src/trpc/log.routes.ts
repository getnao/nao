import { isCloud } from '../env';
import * as logQueries from '../queries/log.queries';
import { logFilterSchema } from '../types/log';
import { adminProtectedProcedure } from './trpc';

export const logRoutes = {
	listLogs: adminProtectedProcedure.input(logFilterSchema).query(async ({ ctx, input }) => {
		// Project-less logs (HTTP requests, system errors) belong to no tenant: on cloud they would leak across organizations.
		return logQueries.listLogs(ctx.project.id, input, { includeProjectlessLogs: !isCloud });
	}),
};
