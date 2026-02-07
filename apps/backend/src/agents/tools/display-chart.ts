import { displayChart } from '@nao/shared/tools';
import { tool } from 'ai';

export default tool({
	description: 'Display a chart visualization of the data from a previous `execute_sql` tool call.',
	inputSchema: displayChart.InputSchema,
	outputSchema: displayChart.OutputSchema,
	execute: async ({ chart_type: chartType, x_axis_key: xAxisKey, series }) => {
		// Validate xAxisKey is provided for bar/area charts
		if ((chartType === 'bar' || chartType === 'line') && !xAxisKey) {
			return { error: `xAxisKey is required for ${chartType} charts.` };
		}

		// Validate pie charts have exactly one series
		if (chartType === 'pie' && series.length !== 1) {
			return { error: 'Pie charts require exactly one series.' };
		}

		// Validate series is not empty
		if (series.length === 0) {
			return { error: 'At least one series is required.' };
		}

		// TODO: check that the chart is displayable and that the data is valid

		return { success: true as const };
	},
});
