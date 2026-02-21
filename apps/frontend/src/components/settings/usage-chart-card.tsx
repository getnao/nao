import type { UsageRecord } from '@nao/backend/usage';
import { ChartDisplay } from '@/components/tool-calls/display-chart';
import { SettingsCard } from '@/components/ui/settings-card';

export interface UsageChartCardProps {
	title: string;
	description: string;
	isLoading: boolean;
	isFetching: boolean;
	isError: boolean;
	data: UsageRecord[];
	chartType: 'bar' | 'stacked_bar';
	series: { data_key: string; color: string; label: string }[];
	xAxisLabelFormatter: (value: string) => string;
	filters: React.ReactNode;
}

export function UsageChartCard({
	title,
	description,
	isLoading,
	isFetching,
	isError,
	data,
	chartType,
	series,
	xAxisLabelFormatter,
	filters,
}: UsageChartCardProps) {
	return (
		<SettingsCard title={title} titleSize='lg' description={description} action={filters}>
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
						data={data as unknown as Record<string, unknown>[]}
						chartType={chartType}
						xAxisKey='date'
						xAxisType='category'
						xAxisLabelFormatter={xAxisLabelFormatter}
						series={series}
						showGrid={true}
					/>
				</div>
			)}
		</SettingsCard>
	);
}
