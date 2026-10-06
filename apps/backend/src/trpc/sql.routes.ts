import { z } from 'zod/v4';

import { getLatestExecuteSqlByQueryId } from '../queries/execute-sql.queries';
import { previewSqlQueryInChat, updateSqlQueryInChat } from '../services/update-sql';
import { cloudBillingMiddleware, protectedProcedure } from './trpc';

const sqlEditInput = z.object({
	queryId: z.string().regex(/^query_.+$/),
	sql_query: z.string().min(1),
	database_id: z.string().nullish(),
	name: z.string().nullish(),
});

const cloudBillingSqlEditProcedure = protectedProcedure.input(sqlEditInput).use(
	cloudBillingMiddleware<{ user: { id: string } }, z.infer<typeof sqlEditInput>>(async (ctx, input) => {
		const existing = await getLatestExecuteSqlByQueryId(input.queryId);
		return existing?.userId === ctx.user.id ? { projectId: existing.projectId } : null;
	}),
);

export const sqlRoutes = {
	previewQuery: cloudBillingSqlEditProcedure.mutation(async ({ input, ctx }) => {
		return previewSqlQueryInChat({
			queryId: input.queryId,
			sqlQuery: input.sql_query,
			databaseId: input.database_id ?? undefined,
			userId: ctx.user.id,
		});
	}),

	updateQuery: cloudBillingSqlEditProcedure.mutation(async ({ input, ctx }) => {
		return updateSqlQueryInChat({
			queryId: input.queryId,
			sqlQuery: input.sql_query,
			databaseId: input.database_id ?? undefined,
			name: input.name ?? undefined,
			userId: ctx.user.id,
		});
	}),
};
