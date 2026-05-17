import { displayChart } from '@nao/shared/tools';
import { tool } from 'ai';

import { DisplayChartOutput, renderToModelOutput } from '../../components/tool-outputs';
import { validateChartConfig } from '../../utils/validate-chart-config';

export default tool<displayChart.Input, displayChart.Output>({
	description: 'Display a chart visualization of the data from a previous `execute_sql` tool call.',
	inputSchema: displayChart.InputSchema,
	outputSchema: displayChart.OutputSchema,

	execute: async (input) => {
		const validation = validateChartConfig(input);
		if (!validation.success) {
			return { _version: '1', success: false, error: validation.error };
		}

		// TODO: check that the chart is displayable and that the data is valid

		return { _version: '1', success: true };
	},

	toModelOutput: ({ output }) => renderToModelOutput(DisplayChartOutput({ output }), output),
});
