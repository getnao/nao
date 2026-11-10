import { createFileRoute, Navigate } from '@tanstack/react-router';
import { MonitoringTabContent } from '@/components/monitoring/monitoring-tab-content';
import { useMonitoringFilters } from '@/hooks/use-monitoring-filters';
import { useMonitoringTabs } from '@/hooks/use-monitoring-tabs';

export const Route = createFileRoute('/_sidebar-layout/settings/monitoring/')({
	component: MonitoringIndexPage,
});

/** Monitoring has no page of its own: it opens the first tab the user can see. */
function MonitoringIndexPage() {
	const tabs = useMonitoringTabs();
	const { range } = useMonitoringFilters();
	const [firstTab] = tabs;

	if (firstTab) {
		return <Navigate to={firstTab.to} search={{ range }} replace />;
	}
	return (
		<MonitoringTabContent>
			<p className='py-6 text-center text-sm text-muted-foreground'>Nothing to monitor on this instance yet.</p>
		</MonitoringTabContent>
	);
}
