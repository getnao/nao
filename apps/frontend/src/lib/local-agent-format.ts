const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WARNING_UTILIZATION = 75;
const CRITICAL_UTILIZATION = 90;
const MINIMUM_SHOWN_COST_USD = 0.01;

const compactFormatter = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const resetDateFormatter = new Intl.DateTimeFormat('en-US', {
	weekday: 'short',
	month: 'short',
	day: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
});

export type MeterSeverity = 'normal' | 'warning' | 'critical';

export function meterSeverity(utilization: number | null): MeterSeverity {
	if (utilization === null || utilization < WARNING_UTILIZATION) {
		return 'normal';
	}
	return utilization < CRITICAL_UTILIZATION ? 'warning' : 'critical';
}

/** "Resets in 3h 20m" within a day, the date beyond. */
export function formatResetTime(resetsAt: string | null, now = new Date()): string | null {
	if (!resetsAt) {
		return null;
	}
	const remaining = Date.parse(resetsAt) - now.getTime();
	if (!Number.isFinite(remaining)) {
		return null;
	}
	if (remaining <= 0) {
		return 'Resets now';
	}
	if (remaining >= DAY_MS) {
		return `Resets ${resetDateFormatter.format(new Date(resetsAt))}`;
	}
	const hours = Math.floor(remaining / HOUR_MS);
	const minutes = Math.floor((remaining % HOUR_MS) / 60_000);
	return `Resets in ${hours > 0 ? `${hours}h ` : ''}${minutes}m`;
}

/** Cents are the finest step shown, so a fraction of a cent reads as less than one rather than $0.00. */
export function formatEstimatedCost(costUsd: number): string {
	if (costUsd > 0 && costUsd < MINIMUM_SHOWN_COST_USD) {
		return `<$${MINIMUM_SHOWN_COST_USD}`;
	}
	return `$${costUsd.toFixed(2)}`;
}

export function formatCompactNumber(value: number): string {
	return compactFormatter.format(value);
}

export function formatPlanName(subscriptionType: string | undefined): string {
	if (!subscriptionType) {
		return 'Unknown';
	}
	return subscriptionType.charAt(0).toUpperCase() + subscriptionType.slice(1);
}
