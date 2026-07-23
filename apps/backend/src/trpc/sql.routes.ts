import { z } from 'zod/v4';

import { previewSqlQueryInChat, updateSqlQueryInChat } from '../services/update-sql';
import { protectedProcedure } from './trpc';

const sqlEditInput = z.object({
	queryId: z.string().regex(/^query_.+$/),
	sql_query: z.string().min(1),
	database_id: z.string().nullish(),
	name: z.string().nullish(),
});

export const sqlRoutes = {
	previewQuery: protectedProcedure.input(sqlEditInput).mutation(async ({ input, ctx }) => {
		return previewSqlQueryInChat({
			queryId: input.queryId,
			sqlQuery: input.sql_query,
			databaseId: input.database_id ?? undefined,
			userId: ctx.user.id,
		});
	}),

	updateQuery: protectedProcedure.input(sqlEditInput).mutation(async ({ input, ctx }) => {
		return updateSqlQueryInChat({
			queryId: input.queryId,
			sqlQuery: input.sql_query,
			databaseId: input.database_id ?? undefined,
			name: input.name ?? undefined,
			userId: ctx.user.id,
		});
	}),
};
