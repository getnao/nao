import { z } from 'zod/v4';

import { getLatestExecuteSqlByQueryId, type LatestExecuteSqlRow } from '../queries/execute-sql.queries';
import { previewSqlQueryInChat, updateSqlQueryInChat } from '../services/update-sql';
import { cloudBillingMiddleware, protectedProcedure } from './trpc';

const sqlEditInput = z.object({
	queryId: z.string().regex(/^query_.+$/),
	sql_query: z.string().min(1),
	database_id: z.string().nullish(),
	name: z.string().nullish(),
});

const resolvedSqlEditProcedure = protectedProcedure.input(sqlEditInput).use(async ({ input, next }) => {
	const existingSqlQuery = await getLatestExecuteSqlByQueryId(input.queryId);
	return next({ ctx: { existingSqlQuery } });
});

const cloudBillingSqlEditProcedure = resolvedSqlEditProcedure.use(
	cloudBillingMiddleware<{
		user: { id: string };
		existingSqlQuery: LatestExecuteSqlRow | null;
	}>(({ existingSqlQuery, user }) =>
		existingSqlQuery?.userId === user.id ? { projectId: existingSqlQuery.projectId } : null,
	),
);

export const sqlRoutes = {
	previewQuery: cloudBillingSqlEditProcedure.mutation(async ({ input, ctx }) => {
		return previewSqlQueryInChat({
			queryId: input.queryId,
			sqlQuery: input.sql_query,
			databaseId: input.database_id ?? undefined,
			userId: ctx.user.id,
			existing: ctx.existingSqlQuery,
		});
	}),

	updateQuery: cloudBillingSqlEditProcedure.mutation(async ({ input, ctx }) => {
		return updateSqlQueryInChat({
			queryId: input.queryId,
			sqlQuery: input.sql_query,
			databaseId: input.database_id ?? undefined,
			name: input.name ?? undefined,
			userId: ctx.user.id,
			existing: ctx.existingSqlQuery,
		});
	}),
};
