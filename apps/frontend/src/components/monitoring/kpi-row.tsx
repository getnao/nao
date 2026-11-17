import type { ReactNode } from 'react';
import type { MonitoringQueryState } from '@/components/monitoring/monitoring-card';
import type { StatusTone } from '@/components/monitoring/status-label';
import { InlineQueryError } from '@/components/monitoring/monitoring-card';
import { StatusIcon } from '@/components/monitoring/status-label';
import { Skeleton } from '@/components/ui/skeleton';

export interface Kpi {
	label: string;
	value: string;
	detail?: ReactNode;
	detailTone?: StatusTone;
}

interface KpiRowProps<T> {
	query: MonitoringQueryState<T>;
	placeholderCount?: number;
	buildKpis: (data: T) => Kpi[];
}

export function KpiRow<T>({ query, placeholderCount = 5, buildKpis }: KpiRowProps<T>) {
	if (query.isError) {
		return <InlineQueryError message={query.error?.message} onRetry={query.refetch} />;
	}
	if (query.isPending || query.data === undefined) {
		return (
			<KpiGrid>
				{Array.from({ length: placeholderCount }, (_, index) => (
					<Skeleton key={index} className='h-[86px] rounded-xl' />
				))}
			</KpiGrid>
		);
	}
	return (
		<KpiGrid>
			{buildKpis(query.data).map((kpi) => (
				<KpiTile key={kpi.label} kpi={kpi} />
			))}
		</KpiGrid>
	);
}

function KpiGrid({ children }: { children: ReactNode }) {
	return <div className='grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5'>{children}</div>;
}

function KpiTile({ kpi }: { kpi: Kpi }) {
	return (
		<div className='flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-background p-4'>
			<span className='truncate text-xs text-muted-foreground'>{kpi.label}</span>
			<span className='truncate text-2xl font-semibold tabular-nums text-foreground'>{kpi.value}</span>
			{kpi.detail && (
				<span className='flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground'>
					{kpi.detailTone && <StatusIcon tone={kpi.detailTone} />}
					<span className='truncate'>{kpi.detail}</span>
				</span>
			)}
		</div>
	);
}
