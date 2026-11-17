import { MONITORING_RANGES } from '@nao/backend/monitoring';
import type { MonitoringRange } from '@nao/backend/monitoring';

export const DEFAULT_MONITORING_RANGE: MonitoringRange = '7d';

export interface MonitoringSearch {
	range?: MonitoringRange;
}

export function validateMonitoringSearch(search: Record<string, unknown>): MonitoringSearch {
	const range = search.range;
	return {
		range:
			typeof range === 'string' && MONITORING_RANGES.includes(range as MonitoringRange)
				? (range as MonitoringRange)
				: undefined,
	};
}
