import { chartTypeSupportsBreakdown } from '@nao/shared/chart-series';
import { builtinChartConfigError, isBuiltinChartType } from '@nao/shared/chart-types';
import { displayChart } from '@nao/shared/tools';

import { DisplayChartOutput, renderToModelOutput } from '../../components/tool-outputs';
import { hasChartPlugin } from '../../services/chart-plugin';
import { getQueryResult } from '../../services/query-result.service';
import { createTool } from '../../utils/tools';

export default createTool<displayChart.Input, displayChart.Output>({
	description: 'Display a chart visualization or formatted table of the data from a previous query result.',
	inputSchema: displayChart.InputSchema,
	outputSchema: displayChart.OutputSchema,

	execute: async (input, context) => {
		if (displayChart.isTableInput(input)) {
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
		if (!isBuiltinChartType(chartType)) {
			if (!context.supportsCustomCharts) {
				return {
					_version: '1',
					success: false,
					error: 'Custom charts are only available in interactive web chats.',
				};
			}
			if (!hasChartPlugin(context.projectFolder, chartType)) {
				return {
					_version: '1',
					success: false,
					error: `Custom chart "${chartType}" is not available in this project.`,
				};
			}
			return { _version: '1', success: true };
		}

		if (input.breakdown_key && !chartTypeSupportsBreakdown(chartType)) {
			return {
				_version: '1',
				success: false,
				error: `${chartType} charts do not support breakdown_key: drop it (pie and donut slices come from x_axis_key).`,
			};
		}

		const configError = builtinChartConfigError(chartType, {
			xAxisKey,
			seriesCount: series.length,
			hasBreakdown: Boolean(input.breakdown_key),
		});
		if (configError) {
			return { _version: '1', success: false, error: configError };
		}

		// TODO: check that the chart is displayable and that the data is valid

		context.generatedArtifacts.charts.push({ ...input, chart_type: chartType });
		return { _version: '1', success: true };
	},

	toModelOutput: ({ output }) => renderToModelOutput(DisplayChartOutput({ output }), output),
});
