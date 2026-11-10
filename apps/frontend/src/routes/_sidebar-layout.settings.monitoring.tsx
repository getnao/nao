import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { MonitoringHeader } from '@/components/monitoring/monitoring-header';
import { useMonitoringTabs } from '@/hooks/use-monitoring-tabs';
import { validateMonitoringSearch } from '@/lib/monitoring-search';
import { findActiveMonitoringTab } from '@/lib/monitoring-tabs';
import { requireAdmin } from '@/lib/route-guards';

export const Route = createFileRoute('/_sidebar-layout/settings/monitoring')({
	beforeLoad: requireAdmin,
	validateSearch: validateMonitoringSearch,
	component: MonitoringLayout,
});

function MonitoringLayout() {
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const tabs = useMonitoringTabs();

	return (
		<div className='flex min-h-0 flex-1 flex-col overflow-hidden bg-background'>
			<MonitoringHeader tabs={tabs} activeTab={findActiveMonitoringTab(pathname, tabs)} />
			<div className='flex min-h-0 flex-1 flex-col'>
				<Outlet />
			</div>
		</div>
	);
}
