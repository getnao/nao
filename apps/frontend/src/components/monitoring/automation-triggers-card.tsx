import type { AutomationsMonitoring } from '@nao/backend/monitoring';
import type { MonitoringQueryState } from '@/components/monitoring/monitoring-card';
import { HorizontalBarList } from '@/components/monitoring/horizontal-bar-list';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { formatInteger, formatPercent, shareOf, TRIGGER_LABELS } from '@/lib/monitoring-format';

export function AutomationTriggersCard({ query }: { query: MonitoringQueryState<AutomationsMonitoring> }) {
	return (
		<MonitoringCard
			title='What starts runs'
			query={query}
			isEmpty={(monitoring) => monitoring.triggers.length === 0}
			emptyMessage='No automation ran in this period.'
		>
			{(monitoring) => <TriggerBars triggers={monitoring.triggers} />}
		</MonitoringCard>
	);
}

function TriggerBars({ triggers }: { triggers: AutomationsMonitoring['triggers'] }) {
	const total = triggers.reduce((sum, trigger) => sum + trigger.count, 0);
	return (
		<HorizontalBarList
			items={triggers.map((trigger) => ({
				key: trigger.trigger,
				label: TRIGGER_LABELS[trigger.trigger],
				value: trigger.count,
				valueLabel: formatPercent(shareOf(trigger.count, total)),
				tooltip: `${formatInteger(trigger.count)} runs`,
			}))}
		/>
	);
}
