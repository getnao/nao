import { displayTable } from '@nao/shared/tools';

import { DisplayTableOutput, renderToModelOutput } from '../../components/tool-outputs';
import { createTool } from '../../utils/tools';

export default createTool<displayTable.Input, displayTable.Output>({
	description:
		'Display a table of the data from a previous `execute_sql` tool call, optionally with conditional formatting applied to specific columns.',
	inputSchema: displayTable.InputSchema,
	outputSchema: displayTable.OutputSchema,

	execute: async (input) => {
		if (!input.query_id) {
			return { _version: '1', success: false, error: 'query_id is required.' };
		}

		return { _version: '1', success: true };
	},

	toModelOutput: ({ output }) => renderToModelOutput(DisplayTableOutput({ output }), output),
});
