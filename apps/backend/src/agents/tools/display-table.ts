import { displayTable } from '@nao/shared/tools';

import { DisplayTableOutput, renderToModelOutput } from '../../components/tool-outputs';
import { getQueryResult } from '../../services/query-result.service';
import { createTool } from '../../utils/tools';

export default createTool<displayTable.Input, displayTable.Output>({
	description:
		'Display a table of the data from a previous `execute_sql` tool call, optionally with conditional formatting applied to specific columns.',
	inputSchema: displayTable.InputSchema,
	outputSchema: displayTable.OutputSchema,

	execute: async (input, context) => {
		if (!input.query_id) {
			return { _version: '1', success: false, error: 'query_id is required.' };
		}

		const queryResult = await getQueryResult(context, input.query_id);
		if (!queryResult) {
			return {
				_version: '1',
				success: false,
				error: `No query result found for query_id "${input.query_id}". Run execute_sql first and reference its Query ID.`,
			};
		}

		return { _version: '1', success: true };
	},

	toModelOutput: ({ output }) => renderToModelOutput(DisplayTableOutput({ output }), output),
});
