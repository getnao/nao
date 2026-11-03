import type { executeSemanticQuery } from '@nao/shared/tools';
import { executeSemanticQuery as schemas } from '@nao/shared/tools';

import { ExecuteSemanticQueryOutput, renderToModelOutput } from '../../components/tool-outputs';
import { compileSemanticQuery } from '../../services/semantic-layer.service';
import type { ToolContext } from '../../types/tools';
import { createTool } from '../../utils/tools';
import { executeQuery } from './execute-sql';

const DESCRIPTION = [
	'Query the governed metrics of the semantic layer. nao compiles the metrics, dimensions and filters to SQL with the official definitions and runs it on the database the layer is configured for.',
	'Discover metrics in semantics/metrics/<metric>.md and dimensions in semantics/dimensions.md first.',
	'The result is a normal query result: its query id works with display_chart, stories, page_query_result and the local database.',
].join(' ');

export default createTool<executeSemanticQuery.Input, executeSemanticQuery.Output>({
	description: DESCRIPTION,
	inputSchema: schemas.InputSchema,
	outputSchema: schemas.OutputSchema,
	execute: (input, context) => runSemanticQuery(input, context),
	toModelOutput: ({ output }) => renderToModelOutput(ExecuteSemanticQueryOutput({ output }), output),
});

/** Compiles the metric query with the current semantic layer definitions, then runs the SQL like execute_sql. */
export async function runSemanticQuery(
	{ name, ...query }: executeSemanticQuery.Input,
	context: ToolContext,
	queryId?: `query_${string}`,
): Promise<executeSemanticQuery.Output> {
	const compiled = await compileSemanticQuery(query, context);
	const output = await executeQuery(
		{ sql_query: compiled.sql, database_id: compiled.database_id, name, query_id: queryId },
		context,
		{ semanticQuery: query },
	);
	return { ...output, compiled_sql: compiled.sql, database_id: compiled.database_id };
}
