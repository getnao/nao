import { memo, useMemo } from 'react';
import { McpAppHeader } from './mcp-app-header';
import { OpenInNaoButton } from './open-in-nao-button';
import type { McpChartEmbedStoredConfig } from '@nao/shared';
import type { displayChart } from '@nao/shared/tools';
import type { ReactNode } from 'react';

import { ChartDisplay } from '@/components/tool-calls/display-chart';
import { sortByDateKey } from '@/lib/charts.utils';

interface ChartAppViewProps {
	config: McpChartEmbedStoredConfig;
	data: Record<string, unknown>[];
	naoUrl?: string;
}

export const ChartAppView = memo(function ChartAppView({ config, data, naoUrl }: ChartAppViewProps) {
	const chartData = useMemo(
		() => (config.xAxisType === 'date' ? sortByDateKey(data, config.xAxisKey) : data),
		[data, config.xAxisKey, config.xAxisType],
	);

	const series = useMemo(
		(): displayChart.SeriesConfig[] =>
			config.series.map((s, i) => ({
				data_key: s.data_key,
				color: s.color ?? `var(--chart-${(i % 5) + 1})`,
				label: s.label,
			})),
		[config.series],
	);

	const xAxisType = config.xAxisType === 'number' ? 'number' : ('category' as const);

	let body: ReactNode;
	if (!chartData.length) {
		body = (
			<div className='flex min-h-[10rem] items-center justify-center px-4 py-10 text-center text-sm text-muted-foreground'>
				Chart data unavailable.
			</div>
		);
	} else if (series.length === 0) {
		body = (
			<div className='flex min-h-[10rem] items-center justify-center px-4 py-10 text-center text-sm text-muted-foreground'>
				No series configured for this chart.
			</div>
		);
	} else {
		body = (
			<div className={`min-h-[14rem] w-full ${config.chartType !== 'kpi_card' ? 'aspect-3/2' : ''}`}>
				<ChartDisplay
					data={chartData}
					chartType={config.chartType}
					xAxisKey={config.xAxisKey}
					xAxisType={xAxisType}
					series={series}
					title={config.title}
				/>
			</div>
		);
	}

	return (
		<div className='flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-background text-foreground'>
			<McpAppHeader title={config.title}>{naoUrl ? <OpenInNaoButton url={naoUrl} /> : null}</McpAppHeader>
			<div className='min-h-0 flex-1 overflow-auto'>
				<div className='mx-auto flex w-full min-w-0 max-w-5xl flex-col p-4 md:p-8'>{body}</div>
			</div>
		</div>
	);
});
