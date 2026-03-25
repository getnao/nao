import { displayChart } from '@nao/shared/tools';
import { tool } from 'ai';

import { DisplayChartOutput, renderToModelOutput } from '../../components/tool-outputs';

export default tool<displayChart.Input, displayChart.Output>({
	description: 'Display a chart visualization of the data from a previous `execute_sql` tool call.',
	inputSchema: displayChart.InputSchema,
	outputSchema: displayChart.OutputSchema,

	execute: async ({ chart_type: chartType, x_axis_key: xAxisKey, series }) => {
		// Validate xAxisKey is provided for bar/area charts
		if ((chartType === 'bar' || chartType === 'line') && !xAxisKey) {
			return { _version: '1', success: false, error: `xAxisKey is required for ${chartType} charts.` };
		}

		// Validate pie charts have exactly one series
		if (chartType === 'pie' && series.length !== 1) {
			return { _version: '1', success: false, error: 'Pie charts require exactly one series.' };
		}

		// Validate breakdown key not set when for pie charts
		if (chartType === 'pie' && series[0].breakdown_key) {
			return { _version: '1', success: false, error: 'Pie charts do not accept a breakdown key.' };
		}

		// Validate series is not empty
		if (series.length === 0) {
			return { _version: '1', success: false, error: 'At least one series is required.' };
		}

		// Validates that breakdown series are not combined with non-breakdown series
		if (series.some((s) => s.breakdown_key) && series.some((s) => s.breakdown_key === undefined)) {
			return {
				_version: '1',
				success: false,
				error: 'Cannot combine breakdown and non-breakdown series.',
			};
		}

		// Validates that only one breakdown series is passed
		if (series.filter((s) => s.breakdown_key).length > 1) {
			return {
				_version: '1',
				success: false,
				error: 'Multiple breakdown series are not supported. Use a single series with a breakdown key.',
			};
		}

		// Stacked bar requires at least two series or a breakdown
		if (chartType === 'stacked_bar' && series.length < 2) {
			if (!series[0]?.breakdown_key) {
				return {
					_version: '1',
					success: false,
					error: 'Stacked bar chart requires at least two series or a breakdown key. Pivot the data to create a series for each stack or provide a breakdown key.',
				};
			}
		}

		// TODO: check that the chart is displayable and that the data is valid

		return { _version: '1', success: true };
	},

	toModelOutput: ({ output }) => renderToModelOutput(DisplayChartOutput({ output }), output),
});
