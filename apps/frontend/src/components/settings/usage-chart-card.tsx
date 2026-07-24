import type { ReactNode } from 'react';
import type { displayChart } from '@nao/shared/tools';
import type { TotalUsageRecord, UsageRecord } from '@nao/backend/usage';
import { ChartDisplay } from '@/components/tool-calls/display-chart';

export interface UsageChartCardProps {
	title: string;
	isLoading: boolean;
	isFetching: boolean;
	isError: boolean;
	data: UsageRecord[] | TotalUsageRecord[];
	chartType: 'bar' | 'stacked_bar' | 'kpi_card';
	series: displayChart.SeriesConfig[];
	xAxisLabelFormatter?: (value: string) => string;
	valueFormatter?: (value: number) => string;
	titleAccessory?: ReactNode;
	showLegend?: boolean;
}

export function UsageChartCard({
	title,
	isLoading,
	isFetching,
	isError,
	data,
	chartType,
	series,
	xAxisLabelFormatter,
	valueFormatter,
	titleAccessory,
	showLegend,
}: UsageChartCardProps) {
	return (
		<div className='h-full min-w-0 rounded-xl p-4'>
			{isError ? (
				<div className='flex items-center justify-center py-12'>
					<p className='text-muted-foreground'>Error loading usage data.</p>
				</div>
			) : isLoading && data.length === 0 ? (
				<div className='flex items-center justify-center py-12'>
					<p className='text-muted-foreground'>Loading usage data...</p>
				</div>
			) : data.length === 0 ? (
				<div className='flex items-center justify-center py-12'>
					<p className='text-muted-foreground'>No usage data available yet.</p>
				</div>
			) : (
				<div className={isFetching ? 'opacity-50' : ''}>
					<ChartDisplay
						title={title}
						titleStyle='left'
						data={data as unknown as Record<string, unknown>[]}
						chartType={chartType}
						xAxisKey='date'
						xAxisType='category'
						xAxisLabelFormatter={xAxisLabelFormatter}
						valueFormatter={valueFormatter}
						series={series}
						titleAccessory={titleAccessory}
						showLegend={showLegend}
						showGrid={true}
						chartContainerClassName={
							chartType === 'kpi_card'
								? undefined
								: 'max-lg:h-[200px] max-lg:max-h-[200px] h-[320px] max-h-[320px]'
						}
						chartContentClassName={
							chartType === 'kpi_card' ? undefined : 'max-lg:min-h-0 max-lg:flex-1 max-lg:aspect-auto'
						}
					/>
				</div>
			)}
		</div>
	);
}
