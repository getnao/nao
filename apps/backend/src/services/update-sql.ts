import { stripSqlFilterBlocks } from '@nao/shared/sql-template';
import type { executeSql } from '@nao/shared/tools';
import { TRPCError } from '@trpc/server';

import { executeQuery } from '../agents/tools/execute-sql';
import {
	getExecuteSqlOwnerByQueryId,
	getExecuteSqlPartByQueryIdInChat,
	updateExecuteSqlPart,
} from '../queries/execute-sql.queries';
import * as projectQueries from '../queries/project.queries';
import type { ToolContext } from '../types/tools';

export async function updateSqlQueryInChat(opts: {
	queryId: string;
	sqlQuery: string;
	databaseId?: string;
	name?: string;
	userId: string;
}): Promise<{ input: executeSql.Input; output: executeSql.Output; toolCallId: string; chatId: string }> {
	const { existing, owner, context, input } = await prepareSqlEditContext(opts);
	const output = await executeQuery({ ...input, query_id: opts.queryId as `query_${string}` }, context);
	await updateExecuteSqlPart(existing.toolCallId, input, output);

	return { input, output, toolCallId: existing.toolCallId, chatId: owner.chatId };
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
}): Promise<{
	existing: NonNullable<Awaited<ReturnType<typeof getExecuteSqlPartByQueryIdInChat>>>;
	owner: NonNullable<Awaited<ReturnType<typeof getExecuteSqlOwnerByQueryId>>>;
	context: ToolContext;
	input: executeSql.Input;
}> {
	assertSqlQueryEditable(opts.sqlQuery);

	const owner = await getExecuteSqlOwnerByQueryId(opts.queryId);
	if (!owner) {
		throw new TRPCError({ code: 'NOT_FOUND', message: `Query ${opts.queryId} not found.` });
	}
	if (owner.userId !== opts.userId) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not authorized to edit this query.' });
	}

	const existing = await getExecuteSqlPartByQueryIdInChat(owner.chatId, opts.queryId);
	if (!existing) {
		throw new TRPCError({ code: 'NOT_FOUND', message: `Query ${opts.queryId} not found.` });
	}

	const project = await projectQueries.retrieveProjectById(owner.projectId);
	if (!project.path) {
		throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Project path not configured.' });
	}

	const agentSettings = await projectQueries.getAgentSettings(owner.projectId);
	const envVars = await projectQueries.getEnvVars(owner.projectId);
	const context: ToolContext = {
		projectFolder: project.path,
		chatId: owner.chatId,
		userId: opts.userId,
		projectId: owner.projectId,
		agentSettings,
		envVars,
		azureAccessToken: null,
		queryResults: new Map(),
		generatedArtifacts: { charts: [], stories: [] },
	};

	const input: executeSql.Input = {
		sql_query: opts.sqlQuery,
		database_id: opts.databaseId ?? existing.toolInput.database_id,
		name: opts.name ?? existing.toolInput.name,
	};

	return { existing, owner, context, input };
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
