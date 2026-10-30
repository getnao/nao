import { executeSemanticQuery } from '@nao/shared/tools';
import { z } from 'zod/v4';

import { getLatestExecuteSqlByQueryId, type LatestExecuteSqlRow } from '../queries/execute-sql.queries';
import {
	compileSemanticQueryInChat,
	describeSemanticLayerForQuery,
	previewSemanticQueryInChat,
	updateSemanticQueryInChat,
} from '../services/update-semantic-query';
import { previewSqlQueryInChat, updateSqlQueryInChat } from '../services/update-sql';
import { cloudBillingMiddleware, protectedProcedure } from './trpc';

const storedQueryInput = z.object({
	queryId: z.string().regex(/^query_.+$/),
});

const sqlEditInput = z.object({
	sql_query: z.string().min(1),
	database_id: z.string().nullish(),
	name: z.string().nullish(),
});

const semanticQueryEditInput = z.object({
	query: z.custom<executeSemanticQuery.SemanticQuery>(
		(value) => executeSemanticQuery.SemanticQuerySchema.safeParse(value).success,
		{ message: 'Invalid semantic query' },
	),
});

const storedQueryProcedure = protectedProcedure.input(storedQueryInput).use(async ({ input, next }) => {
	const existingSqlQuery = await getLatestExecuteSqlByQueryId(input.queryId);
	return next({ ctx: { existingSqlQuery } });
});

const cloudBillingStoredQueryProcedure = storedQueryProcedure.use(
	cloudBillingMiddleware<{
		user: { id: string };
		existingSqlQuery: LatestExecuteSqlRow | null;
	}>(({ existingSqlQuery, user }) =>
		existingSqlQuery?.userId === user.id ? { projectId: existingSqlQuery.projectId } : null,
	),
);

export const sqlRoutes = {
	previewQuery: cloudBillingStoredQueryProcedure.input(sqlEditInput).mutation(async ({ input, ctx }) => {
		return previewSqlQueryInChat({
			queryId: input.queryId,
			sqlQuery: input.sql_query,
			databaseId: input.database_id ?? undefined,
			userId: ctx.user.id,
			existing: ctx.existingSqlQuery,
		});
	}),

	updateQuery: cloudBillingStoredQueryProcedure.input(sqlEditInput).mutation(async ({ input, ctx }) => {
		return updateSqlQueryInChat({
			queryId: input.queryId,
			sqlQuery: input.sql_query,
			databaseId: input.database_id ?? undefined,
			name: input.name ?? undefined,
			userId: ctx.user.id,
			existing: ctx.existingSqlQuery,
		});
	}),

	previewSemanticQuery: cloudBillingStoredQueryProcedure
		.input(semanticQueryEditInput)
		.mutation(async ({ input, ctx }) => {
			return previewSemanticQueryInChat({
				queryId: input.queryId,
				query: input.query,
				userId: ctx.user.id,
				existing: ctx.existingSqlQuery,
			});
		}),

	updateSemanticQuery: cloudBillingStoredQueryProcedure
		.input(semanticQueryEditInput)
		.mutation(async ({ input, ctx }) => {
			return updateSemanticQueryInChat({
				queryId: input.queryId,
				query: input.query,
				userId: ctx.user.id,
				existing: ctx.existingSqlQuery,
			});
		}),

	compileSemanticQuery: storedQueryProcedure.input(semanticQueryEditInput).query(async ({ input, ctx }) => {
		return compileSemanticQueryInChat({
			queryId: input.queryId,
			query: input.query,
			userId: ctx.user.id,
			existing: ctx.existingSqlQuery,
		});
	}),

	semanticLayerCatalog: storedQueryProcedure.query(async ({ input, ctx }) => {
		return describeSemanticLayerForQuery({
			queryId: input.queryId,
			userId: ctx.user.id,
			existing: ctx.existingSqlQuery,
		});
	}),
};
