import { Link } from '@tanstack/react-router';
import type { MonitoringTab } from '@/lib/monitoring-tabs';
import { MonitoringRangeSelect } from '@/components/monitoring/monitoring-filters';
import { useMonitoringFilters } from '@/hooks/use-monitoring-filters';
import { cn } from '@/lib/utils';

interface MonitoringHeaderProps {
	tabs: MonitoringTab[];
	activeTab: MonitoringTab | undefined;
}

export function MonitoringHeader({ tabs, activeTab }: MonitoringHeaderProps) {
	const { range, setRange } = useMonitoringFilters();

	return (
		<header className='flex shrink-0 flex-col gap-4 px-4 pt-6 md:px-8 md:pt-8'>
			<div className='flex flex-wrap items-end justify-between gap-3'>
				<div>
					<h1 className='text-lg font-semibold text-foreground'>Monitoring</h1>
					<p className='text-sm text-muted-foreground'>
						What happens on this project, and what needs a look.
					</p>
				</div>
				{activeTab && <MonitoringRangeSelect value={range} onChange={setRange} />}
			</div>
			<MonitoringTabsNav tabs={tabs} activeTabId={activeTab?.id} />
		</header>
	);
}

function MonitoringTabsNav({ tabs, activeTabId }: { tabs: MonitoringTab[]; activeTabId: string | undefined }) {
	const { range } = useMonitoringFilters();

	return (
		<nav aria-label='Monitoring sections' className='-mb-px flex overflow-x-auto border-b border-border'>
			{tabs.map((tab) => {
				const isActive = tab.id === activeTabId;
				return (
					<Link
						key={tab.id}
						to={tab.to}
						search={{ range }}
						aria-current={isActive ? 'page' : undefined}
						className={cn(
							'-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
							isActive
								? 'border-primary text-foreground'
								: 'border-transparent text-muted-foreground hover:text-foreground',
						)}
					>
						{tab.label}
					</Link>
				);
			})}
		</nav>
	);
}
