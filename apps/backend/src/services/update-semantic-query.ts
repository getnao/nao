import { executeSemanticQuery } from '@nao/shared/tools';
import { TRPCError } from '@trpc/server';

import { runSemanticQuery } from '../agents/tools/execute-semantic-query';
import {
	EXECUTE_SEMANTIC_QUERY_TOOL_NAME,
	type LatestExecuteSqlRow,
	updateSemanticQueryPart,
} from '../queries/execute-sql.queries';
import { buildToolContext } from './agent';
import {
	type CompiledSemanticQuery,
	compileSemanticQuery,
	describeSemanticLayer,
	SemanticQueryCompileError,
} from './semantic-layer.service';

type StoredSemanticQueryOptions = {
	queryId: string;
	userId: string;
	existing: LatestExecuteSqlRow | null;
};

type SemanticQueryEditOptions = StoredSemanticQueryOptions & {
	query: executeSemanticQuery.SemanticQuery;
};

type SemanticQueryUpdate = {
	input: executeSemanticQuery.Input;
	output: executeSemanticQuery.Output;
	toolCallId: string;
	chatId: string;
};

export async function updateSemanticQueryInChat(opts: SemanticQueryEditOptions): Promise<SemanticQueryUpdate> {
	const { existing, context, input } = await prepareSemanticQueryEditContext(opts);
	const output = await withCompileErrorsAsBadRequest(() =>
		runSemanticQuery(input, context, opts.queryId as `query_${string}`),
	);
	await updateSemanticQueryPart(existing.toolCallId, input, output);

	return { input, output, toolCallId: existing.toolCallId, chatId: existing.chatId };
}

export async function previewSemanticQueryInChat(opts: SemanticQueryEditOptions): Promise<executeSemanticQuery.Output> {
	const { context, input } = await prepareSemanticQueryEditContext(opts);
	return withCompileErrorsAsBadRequest(() => runSemanticQuery(input, context, opts.queryId as `query_${string}`));
}

/** Compiles without running anything on the warehouse, to tell whether the definitions changed since the query ran. */
export async function compileSemanticQueryInChat(opts: SemanticQueryEditOptions): Promise<CompiledSemanticQuery> {
	const { context, input } = await prepareSemanticQueryEditContext(opts);
	const { name: _name, ...query } = input;
	return withCompileErrorsAsBadRequest(() => compileSemanticQuery(query, context));
}

/** The metrics and dimensions the query's project exposes, to help edit it. */
export async function describeSemanticLayerForQuery(
	opts: StoredSemanticQueryOptions,
): Promise<executeSemanticQuery.Catalog> {
	const { context } = await resolveStoredSemanticQuery(opts);
	return describeSemanticLayer(context);
}

async function prepareSemanticQueryEditContext(opts: SemanticQueryEditOptions) {
	const { existing, context } = await resolveStoredSemanticQuery(opts);
	const input: executeSemanticQuery.Input = {
		...executeSemanticQuery.SemanticQuerySchema.parse(opts.query),
		name: existing.toolInput.name,
	};
	return { existing, context, input };
}

async function resolveStoredSemanticQuery(opts: StoredSemanticQueryOptions) {
	const existing = opts.existing;
	if (!existing) {
		throw new TRPCError({ code: 'NOT_FOUND', message: `Query ${opts.queryId} not found.` });
	}
	if (existing.userId !== opts.userId) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not authorized to edit this query.' });
	}
	if (existing.toolName !== EXECUTE_SEMANTIC_QUERY_TOOL_NAME) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: `Query ${opts.queryId} is not a semantic query.` });
	}

	const context = await buildToolContext({
		projectId: existing.projectId,
		userId: opts.userId,
		chatId: existing.chatId,
		adminMode: existing.adminMode,
	});

	return { existing, context };
}

async function withCompileErrorsAsBadRequest<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		if (error instanceof SemanticQueryCompileError) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: error.message, cause: error });
		}
		throw error;
	}
}
