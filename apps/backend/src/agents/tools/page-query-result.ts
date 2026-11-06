import type { pageQueryResult } from '@nao/shared/tools';
import { pageQueryResult as schemas, QueryIdSchema } from '@nao/shared/tools';

import { PageQueryResultOutput, renderToModelOutput } from '../../components/tool-outputs';
import { getQueryResult } from '../../services/query-result.service';
import { createTool } from '../../utils/tools';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const OTHER_TOOLS_HINT = 'To get new data, call execute_sql. To read a file such as a columns.md, call read.';

export default createTool<pageQueryResult.Input, pageQueryResult.Output>({
	description:
		'Page through more rows of a previously executed `execute_sql` query result, by `query_id`. Use this when the rows shown in an `execute_sql` output were truncated and you need to inspect more of the data — it does not re-run the SQL, it pages through the cached result. Works for any query run earlier in this chat (including previous turns). It cannot read files: use `read` for context files.',
	inputSchema: schemas.InputSchema,
	outputSchema: schemas.OutputSchema,
	execute: async ({ query_id, offset = 0, limit = DEFAULT_LIMIT }, context) => {
		if (!QueryIdSchema.safeParse(query_id).success) {
			throw new Error(
				`"${query_id}" is not a query id. page_query_result only pages the rows of an execute_sql result, using the id from its "Query ID" line (e.g. "query_a1b2c3d4"). ${OTHER_TOOLS_HINT}`,
			);
		}

		const stored = await getQueryResult(context, query_id);
		if (!stored) {
			throw new Error(
				`Query result not found for id "${query_id}". Use an id from the "Query ID" line of an execute_sql output in this chat, or from the conversation-artifacts list. Never invent one. ${OTHER_TOOLS_HINT}`,
			);
		}

		const effectiveLimit = Math.min(limit, MAX_LIMIT);
		const data = stored.data.slice(offset, offset + effectiveLimit);

		return {
			_version: '1' as const,
			id: query_id as `query_${string}`,
			columns: stored.columns,
			data,
			row_count: stored.data.length,
			offset,
			limit: effectiveLimit,
		};
	},
	toModelOutput: ({ output }) => renderToModelOutput(PageQueryResultOutput({ output }), output),
});
