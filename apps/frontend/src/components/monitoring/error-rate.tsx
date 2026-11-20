import { StatusIcon } from '@/components/monitoring/status-label';
import { formatPercent } from '@/lib/monitoring-format';

const HIGH_ERROR_RATE = 0.05;

export function ErrorRate({ rate }: { rate: number }) {
	const isHigh = rate >= HIGH_ERROR_RATE;
	return (
		<span className='inline-flex items-center justify-end gap-1'>
			{isHigh && <StatusIcon tone='warning' />}
			{isHigh && <span className='sr-only'>High error rate:</span>}
			{formatPercent(rate)}
		</span>
	);
}
