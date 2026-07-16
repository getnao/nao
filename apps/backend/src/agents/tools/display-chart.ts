import { displayChart } from '@nao/shared/tools';

import { DisplayChartOutput, renderToModelOutput } from '../../components/tool-outputs';
import { getQueryResult } from '../../services/query-result.service';
import { createTool } from '../../utils/tools';

export default createTool<displayChart.Input, displayChart.Output>({
	description:
		'Display a chart visualization or formatted table of the data from a previous `execute_sql` tool call.',
	inputSchema: displayChart.InputSchema,
	outputSchema: displayChart.OutputSchema,

	execute: async (input, context) => {
		if (input.chart_type === 'table') {
			const queryResult = await getQueryResult(context, input.query_id);
			if (!queryResult) {
				return {
					_version: '1',
					success: false,
					error: `No query result found for query_id "${input.query_id}". Run execute_sql first and reference its Query ID.`,
				};
			}

			return { _version: '1', success: true };
		}

		const { chart_type: chartType, x_axis_key: xAxisKey, series } = input;

		// Validate xAxisKey is provided for cartesian and polar charts
		if (displayChart.chartTypeRequiresXAxisKey(chartType) && !xAxisKey) {
			return { _version: '1', success: false, error: `xAxisKey is required for ${chartType} charts.` };
		}

		// Validate pie and donut charts have exactly one series
		if (displayChart.isPieChart(chartType) && series.length !== 1) {
			return {
				_version: '1',
				success: false,
				error: `${chartType === 'donut' ? 'Donut' : 'Pie'} charts require exactly one series.`,
			};
		}

		// Validate series is not empty
		if (series.length === 0) {
			return { _version: '1', success: false, error: 'At least one series is required.' };
		}

		// Stacked charts require at least two series
		if (displayChart.isStackedChartType(chartType) && series.length < 2) {
			return {
				_version: '1',
				success: false,
				error: `Stacked ${chartType.includes('bar') ? 'bar' : 'area'} chart requires at least two series. You may need to pivot the data to create a series for each stack.`,
			};
		}

		// TODO: check that the chart is displayable and that the data is valid

		context.generatedArtifacts.charts.push(input);
		return { _version: '1', success: true };
	},

	toModelOutput: ({ output }) => renderToModelOutput(DisplayChartOutput({ output }), output),
});
