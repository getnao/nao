import type { displayChart } from '@nao/shared/tools';

export function validateChartConfig({
	chart_type: chartType,
	x_axis_key: xAxisKey,
	series,
}: displayChart.Input): { success: true } | { success: false; error: string } {
	if (['bar', 'line', 'area', 'stacked_area', 'scatter', 'radar'].includes(chartType) && !xAxisKey) {
		return { success: false, error: `xAxisKey is required for ${chartType} charts.` };
	}

	if (chartType === 'pie' && series.length !== 1) {
		return { success: false, error: 'Pie charts require exactly one series.' };
	}

	if (series.length === 0) {
		return { success: false, error: 'At least one series is required.' };
	}

	if ((chartType === 'stacked_bar' || chartType === 'stacked_area') && series.length < 2) {
		return {
			success: false,
			error: `Stacked ${chartType === 'stacked_bar' ? 'bar' : 'area'} chart requires at least two series. You may need to pivot the data to create a series for each stack.`,
		};
	}

	return { success: true };
}
