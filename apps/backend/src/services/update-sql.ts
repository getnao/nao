import { stripSqlFilterBlocks } from '@nao/shared/sql-template';
import type { executeSql } from '@nao/shared/tools';
import { TRPCError } from '@trpc/server';

import { executeQuery } from '../agents/tools/execute-sql';
import { getLatestExecuteSqlByQueryId, updateExecuteSqlPart } from '../queries/execute-sql.queries';
import { buildToolContext } from './agent';

export async function updateSqlQueryInChat(opts: {
	queryId: string;
	sqlQuery: string;
	databaseId?: string;
	name?: string;
	userId: string;
}): Promise<{ input: executeSql.Input; output: executeSql.Output; toolCallId: string; chatId: string }> {
	const { existing, context, input } = await prepareSqlEditContext(opts);
	const output = await executeQuery({ ...input, query_id: opts.queryId as `query_${string}` }, context);
	await updateExecuteSqlPart(existing.toolCallId, input, output);

	return { input, output, toolCallId: existing.toolCallId, chatId: existing.chatId };
}

export async function previewSqlQueryInChat(opts: {
	queryId: string;
	sqlQuery: string;
	databaseId?: string;
	userId: string;
}): Promise<executeSql.Output> {
	const { context, input } = await prepareSqlEditContext(opts);
	return executeQuery(input, context);
}

async function prepareSqlEditContext(opts: {
	queryId: string;
	sqlQuery: string;
	databaseId?: string;
	name?: string;
	userId: string;
}) {
	assertSqlQueryEditable(opts.sqlQuery);

	const existing = await getLatestExecuteSqlByQueryId(opts.queryId);
	if (!existing) {
		throw new TRPCError({ code: 'NOT_FOUND', message: `Query ${opts.queryId} not found.` });
	}
	if (existing.userId !== opts.userId) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not authorized to edit this query.' });
	}

	const context = await buildToolContext({
		projectId: existing.projectId,
		userId: opts.userId,
		chatId: existing.chatId,
		adminMode: existing.adminMode,
	});

	const input: executeSql.Input = {
		sql_query: opts.sqlQuery,
		database_id: opts.databaseId ?? existing.toolInput.database_id ?? undefined,
		name: opts.name ?? existing.toolInput.name ?? undefined,
	};

	return { existing, context, input };
}

export function assertSqlQueryEditable(sqlQuery: string): void {
	if (!sqlQuery.trim()) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'SQL query cannot be empty.' });
	}
	if (stripSqlFilterBlocks(sqlQuery).trim() === '') {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'SQL query cannot be empty after removing filter blocks.',
		});
	}
}
