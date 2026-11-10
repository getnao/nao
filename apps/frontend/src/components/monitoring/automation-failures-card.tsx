import { Link } from '@tanstack/react-router';
import type { AutomationRunFailure, AutomationsMonitoring } from '@nao/backend/monitoring';
import type { MonitoringQueryState } from '@/components/monitoring/monitoring-card';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { DEFAULT_USAGE_SEARCH } from '@/components/settings/usage-route-search';
import { StatusIcon } from '@/components/monitoring/status-label';
import { formatDateTime, TRIGGER_LABELS } from '@/lib/monitoring-format';

export function AutomationFailuresCard({ query }: { query: MonitoringQueryState<AutomationsMonitoring> }) {
	return (
		<MonitoringCard
			title='Recent failures'
			query={query}
			isEmpty={(monitoring) => monitoring.recentFailures.length === 0}
			emptyMessage='No run failed in this period.'
		>
			{(monitoring) => (
				<ul className='flex flex-col divide-y divide-border'>
					{monitoring.recentFailures.map((failure) => (
						<FailureRow key={failure.runId} failure={failure} />
					))}
				</ul>
			)}
		</MonitoringCard>
	);
}

function FailureRow({ failure }: { failure: AutomationRunFailure }) {
	return (
		<li className='grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 py-2 text-sm first:pt-0 last:pb-0'>
			<StatusIcon tone='error' className='mt-0.5' />
			<div className='flex min-w-0 flex-col gap-0.5'>
				<span className='truncate font-medium text-foreground'>{failure.automationTitle}</span>
				<span className='truncate text-xs text-muted-foreground' title={failure.errorMessage ?? undefined}>
					{failure.errorMessage ?? 'No error message'}
				</span>
			</div>
			<div className='flex flex-col items-end gap-0.5 text-xs text-muted-foreground'>
				<span className='whitespace-nowrap'>
					{formatDateTime(failure.startedAt)} · {TRIGGER_LABELS[failure.trigger]}
				</span>
				{failure.chatId && (
					<Link
						to='/settings/usage/replay/$chatId'
						params={{ chatId: failure.chatId }}
						search={{ ...DEFAULT_USAGE_SEARCH, tab: 'usage' }}
						className='font-medium text-primary hover:underline'
					>
						Open run
					</Link>
				)}
			</div>
		</li>
	);
}
