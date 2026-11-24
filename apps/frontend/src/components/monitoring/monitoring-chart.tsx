import type { displayChart } from '@nao/shared/tools';
import { ChartDisplay } from '@/components/tool-calls/display-chart';

export interface MonitoringSeries {
	dataKey: string;
	label: string;
}

interface MonitoringChartProps {
	type: 'stacked_bar' | 'line';
	data: Record<string, unknown>[];
	xAxisKey: string;
	series: MonitoringSeries[];
	xAxisLabelFormatter?: (value: string) => string;
	valueFormatter?: (value: number) => string;
	seriesColors?: string[];
}

/** Stacked bars and lines for the monitoring tabs, drawn with the same chart engine and palette as the Usage page. */
export function MonitoringChart({
	type,
	data,
	xAxisKey,
	series,
	xAxisLabelFormatter,
	valueFormatter,
	seriesColors,
}: MonitoringChartProps) {
	const chartSeries: displayChart.SeriesConfig[] = series.map((item, index) => ({
		data_key: item.dataKey,
		label: item.label,
		color: seriesColors?.[index] ?? `var(--chart-${index + 1})`,
	}));

	return (
		<ChartDisplay
			data={data}
			chartType={type}
			xAxisKey={xAxisKey}
			xAxisType='category'
			xAxisLabelFormatter={xAxisLabelFormatter}
			valueFormatter={valueFormatter}
			series={chartSeries}
			showLegend={series.length >= 2}
			showGrid={true}
			chartContainerClassName='h-[220px] max-h-[220px]'
			chartContentClassName='min-h-0 flex-1 aspect-auto'
		/>
	);
}
