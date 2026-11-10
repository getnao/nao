import type { AutomationsMonitoring, MonitoringRange } from '@nao/backend/monitoring';
import type { MonitoringQueryState } from '@/components/monitoring/monitoring-card';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { MonitoringChart } from '@/components/monitoring/monitoring-chart';
import { formatBucketLabel } from '@/lib/monitoring-format';

const RUN_SERIES = [
	{ dataKey: 'completed', label: 'Completed' },
	{ dataKey: 'failed', label: 'Failed' },
	{ dataKey: 'cancelled', label: 'Cancelled' },
	{ dataKey: 'running', label: 'Running' },
];

const RUN_SERIES_COLORS = ['var(--chart-1)', 'var(--destructive)', 'var(--muted-foreground)', 'var(--chart-3)'];

export function AutomationRunsCard({
	query,
	range,
}: {
	query: MonitoringQueryState<AutomationsMonitoring>;
	range: MonitoringRange;
}) {
	return (
		<MonitoringCard
			title='Runs'
			subtitle={range === '24h' ? 'per hour' : 'per day'}
			query={query}
			isEmpty={(monitoring) => monitoring.kpis.runs.current === 0}
			emptyMessage='No automation ran in this period.'
		>
			{(monitoring) => (
				<MonitoringChart
					type='stacked_bar'
					data={monitoring.runsOverTime}
					xAxisKey='bucket'
					series={RUN_SERIES}
					seriesColors={RUN_SERIES_COLORS}
					xAxisLabelFormatter={(bucket) => formatBucketLabel(bucket, range)}
				/>
			)}
		</MonitoringCard>
	);
}
