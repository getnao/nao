import type { executeSemanticQuery } from '@nao/shared/tools';
import { executeSemanticQuery as schemas } from '@nao/shared/tools';

import { ExecuteSemanticQueryOutput, renderToModelOutput } from '../../components/tool-outputs';
import { compileSemanticQuery } from '../../services/semantic-layer.service';
import { createTool } from '../../utils/tools';
import { executeQuery } from './execute-sql';

const DESCRIPTION = [
	'Query the governed metrics of the semantic layer. nao compiles the metrics, dimensions and filters to SQL with the official definitions and runs it on the database the layer is configured for.',
	'Discover metrics in semantics/metrics/<metric>.md and dimensions in semantics/dimensions.md first.',
	'The result is a normal query result: its query id works with display_chart, stories, read_query_result and the local database.',
].join(' ');

export default createTool<executeSemanticQuery.Input, executeSemanticQuery.Output>({
	description: DESCRIPTION,
	inputSchema: schemas.InputSchema,
	outputSchema: schemas.OutputSchema,
	execute: async ({ name, ...query }, context) => {
		const compiled = await compileSemanticQuery(query, context);
		const output = await executeQuery(
			{ sql_query: compiled.sql, database_id: compiled.database_id, name },
			context,
			{ compiledBySemanticLayer: true },
		);
		return { ...output, compiled_sql: compiled.sql, database_id: compiled.database_id };
	},
	toModelOutput: ({ output }) => renderToModelOutput(ExecuteSemanticQueryOutput({ output }), output),
});
