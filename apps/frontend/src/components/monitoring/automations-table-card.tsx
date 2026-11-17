import type { AutomationMonitoringRow, AutomationsMonitoring } from '@nao/backend/monitoring';
import type { MonitoringQueryState } from '@/components/monitoring/monitoring-card';
import { ErrorRate } from '@/components/monitoring/error-rate';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { RunStatusLabel } from '@/components/monitoring/status-label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, formatDuration, formatInteger } from '@/lib/monitoring-format';

export function AutomationsTableCard({ query }: { query: MonitoringQueryState<AutomationsMonitoring> }) {
	return (
		<MonitoringCard
			title='Automations'
			subtitle='most failing first'
			query={query}
			isEmpty={(monitoring) => monitoring.automations.length === 0}
			emptyMessage='This project has no automation yet.'
		>
			{(monitoring) => (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Automation</TableHead>
							<TableHead>Owner</TableHead>
							<TableHead className='text-right'>Runs</TableHead>
							<TableHead className='text-right'>Failure rate</TableHead>
							<TableHead className='text-right'>Median duration</TableHead>
							<TableHead>Last run</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{monitoring.automations.map((automation) => (
							<AutomationRow key={automation.id} automation={automation} />
						))}
					</TableBody>
				</Table>
			)}
		</MonitoringCard>
	);
}

function AutomationRow({ automation }: { automation: AutomationMonitoringRow }) {
	return (
		<TableRow>
			<TableCell className='max-w-72'>
				<div className='flex min-w-0 items-center gap-2'>
					<span className='truncate font-medium' title={automation.title}>
						{automation.title}
					</span>
					{!automation.isActive && (
						<Badge variant='secondary' className='shrink-0 px-1.5 py-0 text-[10px]'>
							Paused
						</Badge>
					)}
				</div>
			</TableCell>
			<TableCell className='text-muted-foreground'>{automation.owner?.name ?? 'Deleted user'}</TableCell>
			<TableCell className='text-right tabular-nums'>{formatInteger(automation.runs)}</TableCell>
			<TableCell className='text-right tabular-nums'>
				{automation.runs > 0 ? <ErrorRate rate={automation.failureRate} /> : '—'}
			</TableCell>
			<TableCell className='text-right tabular-nums'>{formatDuration(automation.durationP50Ms)}</TableCell>
			<TableCell>
				{automation.lastRun ? (
					<span className='flex items-center gap-2 text-muted-foreground'>
						<RunStatusLabel status={automation.lastRun.status} className='text-foreground' />
						<span className='whitespace-nowrap'>{formatDateTime(automation.lastRun.startedAt)}</span>
					</span>
				) : (
					<span className='text-muted-foreground'>Never ran</span>
				)}
			</TableCell>
		</TableRow>
	);
}
