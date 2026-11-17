import type { MonitoringRange } from '../types/monitoring';

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

const RANGE_DURATION_MS: Record<MonitoringRange, number> = {
	'24h': DAY_MS,
	'7d': 7 * DAY_MS,
	'30d': 30 * DAY_MS,
};

/** The selected range and the equal-length period right before it, used for "vs previous" comparisons. */
export interface MonitoringWindow {
	range: MonitoringRange;
	since: Date;
	until: Date;
	previousSince: Date;
}

export function resolveMonitoringWindow(range: MonitoringRange, now: Date = new Date()): MonitoringWindow {
	const durationMs = RANGE_DURATION_MS[range];
	return {
		range,
		since: new Date(now.getTime() - durationMs),
		until: now,
		previousSince: new Date(now.getTime() - 2 * durationMs),
	};
}

/** UTC hour buckets (`YYYY-MM-DDTHH`) for the 24h range, UTC day buckets (`YYYY-MM-DD`) otherwise. */
export function toBucketKey(date: Date, range: MonitoringRange): string {
	const iso = date.toISOString();
	return range === '24h' ? iso.slice(0, 13) : iso.slice(0, 10);
}

export function listBucketKeys(window: MonitoringWindow): string[] {
	const stepMs = window.range === '24h' ? HOUR_MS : DAY_MS;
	const keys: string[] = [];
	for (let time = floorTo(window.since.getTime(), stepMs); time <= window.until.getTime(); time += stepMs) {
		keys.push(toBucketKey(new Date(time), window.range));
	}
	return keys;
}

export function isInCurrentPeriod(date: Date, window: MonitoringWindow): boolean {
	return date >= window.since && date <= window.until;
}

/** Nearest-rank percentile; null when there is nothing to rank. */
export function percentile(values: number[], fraction: number): number | null {
	if (values.length === 0) {
		return null;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const rank = Math.ceil(fraction * sorted.length) - 1;
	return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

export function ratio(numerator: number, denominator: number): number {
	return denominator > 0 ? numerator / denominator : 0;
}

export function durationBetween(startedAt: Date, finishedAt: Date | null): number | null {
	return finishedAt ? Math.max(finishedAt.getTime() - startedAt.getTime(), 0) : null;
}

function floorTo(time: number, stepMs: number): number {
	return Math.floor(time / stepMs) * stepMs;
}
