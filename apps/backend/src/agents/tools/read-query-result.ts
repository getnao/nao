import type { readQueryResult } from '@nao/shared/tools';
import { readQueryResult as schemas } from '@nao/shared/tools';

import { ReadQueryResultOutput, renderToModelOutput } from '../../components/tool-outputs';
import { getQueryResult } from '../../services/query-result.service';
import { createTool } from '../../utils/tools';

const DEFAULT_LIMIT = 20;

export default createTool<readQueryResult.Input, readQueryResult.Output>({
	description:
		'Read more rows from a previously executed `execute_sql` query result, by `query_id`. Use this when the rows shown in an `execute_sql` output were truncated and you need to inspect more of the data — it does not re-run the SQL, it pages through the cached result. Works for any query run earlier in this chat (including previous turns).',
	inputSchema: schemas.InputSchema,
	outputSchema: schemas.OutputSchema,
	execute: async ({ query_id, offset = 0, limit = DEFAULT_LIMIT }, context) => {
		const stored = await getQueryResult(context, query_id);
		if (!stored) {
			throw new Error(
				`Query result not found for id "${query_id}". The id must come from an execute_sql tool call earlier in this chat.`,
			);
		}

		const data = stored.data.slice(offset, offset + limit);

		return {
			_version: '1' as const,
			id: query_id as `query_${string}`,
			columns: stored.columns,
			data,
			row_count: stored.data.length,
			offset,
			limit,
		};
	},
	toModelOutput: ({ output }) => renderToModelOutput(ReadQueryResultOutput({ output }), output),
});
