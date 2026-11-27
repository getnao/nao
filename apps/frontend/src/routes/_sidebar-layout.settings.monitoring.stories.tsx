import { createFileRoute } from '@tanstack/react-router';
import { StoriesMonitoring } from '@/components/monitoring/stories-monitoring';
import { MonitoringTabContent } from '@/components/monitoring/monitoring-tab-content';

export const Route = createFileRoute('/_sidebar-layout/settings/monitoring/stories')({
	component: StoriesMonitoringPage,
});

function StoriesMonitoringPage() {
	return (
		<MonitoringTabContent>
			<StoriesMonitoring />
		</MonitoringTabContent>
	);
}
