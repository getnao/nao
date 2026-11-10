import type { AutomationRunTriggerKey, MonitoringRange } from '@nao/backend/monitoring';

const EMPTY_VALUE = '—';

const integerFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const dayFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const hourFormatter = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	day: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
});

export const TRIGGER_LABELS: Record<AutomationRunTriggerKey, string> = {
	schedule: 'Schedule',
	manual: 'Run now',
	webhook: 'Webhook',
	feedback: 'Feedback',
	unknown: 'Not recorded',
};

export function formatDuration(milliseconds: number | null | undefined): string {
	if (milliseconds == null || !Number.isFinite(milliseconds)) {
		return EMPTY_VALUE;
	}
	if (milliseconds < 1000) {
		return `${Math.round(milliseconds)}ms`;
	}
	const seconds = milliseconds / 1000;
	if (seconds < 60) {
		return `${trimTrailingZero(seconds.toFixed(1))}s`;
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m ${Math.floor(seconds % 60)}s`;
	}
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatInteger(value: number | null | undefined): string {
	if (value == null || !Number.isFinite(value)) {
		return EMPTY_VALUE;
	}
	return integerFormatter.format(value);
}

/** Formats a 0–1 ratio as a percentage, keeping one decimal only when it carries information. */
export function formatPercent(ratio: number | null | undefined): string {
	if (ratio == null || !Number.isFinite(ratio)) {
		return EMPTY_VALUE;
	}
	const percent = ratio * 100;
	if (percent === 0) {
		return '0%';
	}
	const digits = Math.abs(percent) < 10 ? 1 : 0;
	return `${trimTrailingZero(percent.toFixed(digits))}%`;
}

/** Relative change between two periods, e.g. "+8%"; null when there is no previous value to compare to. */
export function formatChange(current: number, previous: number | null | undefined): string | null {
	if (previous == null || previous === 0 || !Number.isFinite(previous)) {
		return null;
	}
	const change = (current - previous) / previous;
	return `${change >= 0 ? '+' : ''}${formatPercent(change)}`;
}

/** Difference between two 0–1 rates in percentage points, e.g. "+0.4 pt". */
export function formatPointChange(current: number, previous: number): string {
	const points = (current - previous) * 100;
	return `${points >= 0 ? '+' : ''}${trimTrailingZero(points.toFixed(1))} pt`;
}

export function shareOf(part: number, total: number): number {
	return total > 0 ? part / total : 0;
}

export function formatDateTime(value: Date | string): string {
	return dateTimeFormatter.format(new Date(value));
}

/**
 * Labels a chart bucket. Hour buckets (`YYYY-MM-DDTHH`, UTC) are instants, shown in the viewer's time like
 * the other times of the page; day buckets (`YYYY-MM-DD`) are UTC days and keep their UTC date.
 */
export function formatBucketLabel(bucket: string, range: MonitoringRange): string {
	if (range === '24h') {
		const date = new Date(`${bucket}:00:00Z`);
		return Number.isNaN(date.getTime()) ? bucket : hourFormatter.format(date);
	}
	const date = new Date(`${bucket}T00:00:00Z`);
	return Number.isNaN(date.getTime()) ? bucket : dayFormatter.format(date);
}

function trimTrailingZero(value: string): string {
	return value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}
