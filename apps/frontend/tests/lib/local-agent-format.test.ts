import { describe, expect, it } from 'vitest';

import { formatEstimatedCost, formatResetTime, meterSeverity } from '@/lib/local-agent-format';

const NOW = new Date('2026-11-14T12:00:00Z');

describe('meterSeverity', () => {
	it.each([
		[null, 'normal'],
		[74, 'normal'],
		[75, 'warning'],
		[89, 'warning'],
		[90, 'critical'],
	] as const)('reads %s%% as %s', (utilization, severity) => {
		expect(meterSeverity(utilization)).toBe(severity);
	});
});

describe('formatResetTime', () => {
	it.each([
		['2026-11-14T15:20:00Z', 'Resets in 3h 20m'],
		['2026-11-14T12:45:00Z', 'Resets in 45m'],
		['2026-11-14T11:00:00Z', 'Resets now'],
	])('counts down to a reset within a day (%s)', (resetsAt, label) => {
		expect(formatResetTime(resetsAt, NOW)).toBe(label);
	});

	it('gives the date of a reset more than a day away', () => {
		expect(formatResetTime('2026-11-16T09:00:00Z', NOW)).toMatch(/^Resets (Sun|Mon), Nov 1[56], \d{2}:\d{2}$/);
	});

	it('has nothing to say without a reset time', () => {
		expect(formatResetTime(null, NOW)).toBeNull();
	});
});

describe('formatEstimatedCost', () => {
	it.each([
		[0, '$0.00'],
		[0.00045, '<$0.01'],
		[1.5, '$1.50'],
	])('shows %s as %s', (costUsd, label) => {
		expect(formatEstimatedCost(costUsd)).toBe(label);
	});
});
