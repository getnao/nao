import { MONITORING_RANGES } from '@nao/backend/monitoring';
import type { MonitoringRange } from '@nao/backend/monitoring';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const RANGE_LABELS: Record<MonitoringRange, string> = {
	'24h': 'Last 24 hours',
	'7d': 'Last 7 days',
	'30d': 'Last 30 days',
};

export function MonitoringRangeSelect({
	value,
	onChange,
}: {
	value: MonitoringRange;
	onChange: (range: MonitoringRange) => void;
}) {
	return (
		<Select value={value} onValueChange={(next) => onChange(next as MonitoringRange)}>
			<SelectTrigger className='w-36' aria-label='Time range'>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{MONITORING_RANGES.map((range) => (
					<SelectItem key={range} value={range}>
						{RANGE_LABELS[range]}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
