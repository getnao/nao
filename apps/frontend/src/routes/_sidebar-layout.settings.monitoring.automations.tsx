import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { AutomationFailuresCard } from '@/components/monitoring/automation-failures-card';
import { AutomationRunsCard } from '@/components/monitoring/automation-runs-card';
import { AutomationTriggersCard } from '@/components/monitoring/automation-triggers-card';
import { AutomationsKpis } from '@/components/monitoring/automations-kpis';
import { AutomationsTableCard } from '@/components/monitoring/automations-table-card';
import { MonitoringGrid, MonitoringTabContent } from '@/components/monitoring/monitoring-tab-content';
import { useMonitoringFilters } from '@/hooks/use-monitoring-filters';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/monitoring/automations')({
	component: AutomationsMonitoringPage,
});

function AutomationsMonitoringPage() {
	const { range } = useMonitoringFilters();
	const monitoring = useQuery(trpc.monitoring.getAutomations.queryOptions({ range }));

	return (
		<MonitoringTabContent>
			<AutomationsKpis query={monitoring} />
			<MonitoringGrid layout='two-one'>
				<AutomationRunsCard query={monitoring} range={range} />
				<AutomationTriggersCard query={monitoring} />
			</MonitoringGrid>
			<AutomationFailuresCard query={monitoring} />
			<AutomationsTableCard query={monitoring} />
		</MonitoringTabContent>
	);
}
