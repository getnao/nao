import { useNavigate, useSearch } from '@tanstack/react-router';
import type { MonitoringRange } from '@nao/backend/monitoring';
import { DEFAULT_MONITORING_RANGE } from '@/lib/monitoring-search';

/** The range shared by every monitoring tab, kept in the URL so views can be linked and reloaded. */
export function useMonitoringFilters() {
	const search = useSearch({ from: '/_sidebar-layout/settings/monitoring' });
	const navigate = useNavigate();

	return {
		range: search.range ?? DEFAULT_MONITORING_RANGE,
		setRange: (range: MonitoringRange) => {
			navigate({ to: '.', search: (current: Record<string, unknown>) => ({ ...current, range }), replace: true });
		},
	};
}
