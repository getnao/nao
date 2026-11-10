import type { AutomationsKpis, AutomationsMonitoring, PeriodValue } from '@nao/backend/monitoring';
import type { Kpi } from '@/components/monitoring/kpi-row';
import type { MonitoringQueryState } from '@/components/monitoring/monitoring-card';
import { KpiRow } from '@/components/monitoring/kpi-row';
import { formatChange, formatDuration, formatInteger, formatPercent, formatPointChange } from '@/lib/monitoring-format';

const VS_PREVIOUS = 'vs previous period';

export function AutomationsKpis({ query }: { query: MonitoringQueryState<AutomationsMonitoring> }) {
	return <KpiRow query={query} buildKpis={(monitoring) => buildKpis(monitoring.kpis)} />;
}

function buildKpis(kpis: AutomationsKpis): Kpi[] {
	return [
		{ label: 'Runs', value: formatInteger(kpis.runs.current), detail: describeChange(kpis.runs) },
		{
			label: 'Success rate',
			value: formatPercent(kpis.successRate.current),
			detail: describeRateChange(kpis.successRate),
		},
		{
			label: 'Failed runs',
			value: formatInteger(kpis.failedRuns.current),
			detail: describeChange(kpis.failedRuns),
			detailTone: kpis.failedRuns.current > 0 ? 'error' : undefined,
		},
		{
			label: 'Median duration',
			value: formatDuration(kpis.durationP50Ms),
			detail: kpis.durationP95Ms === null ? undefined : `p95 ${formatDuration(kpis.durationP95Ms)}`,
		},
		{
			label: 'Active automations',
			value: formatInteger(kpis.activeAutomations),
			detail: `of ${formatInteger(kpis.totalAutomations)} in this project`,
		},
	];
}

function describeChange({ current, previous }: PeriodValue<number>): string | undefined {
	const change = formatChange(current, previous);
	return change ? `${change} ${VS_PREVIOUS}` : undefined;
}

function describeRateChange({ current, previous }: PeriodValue<number | null>): string | undefined {
	if (current === null || previous === null) {
		return undefined;
	}
	return `${formatPointChange(current, previous)} ${VS_PREVIOUS}`;
}
