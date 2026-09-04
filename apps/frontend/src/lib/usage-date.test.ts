import { describe, expect, it } from 'vitest';

import { formatUsageBucketLabel } from './usage-date';

describe('formatUsageBucketLabel', () => {
	it.each([
		['2026-09-03 08:00', 'hour', 'Sep 3, 08:00'],
		['2026-09-03', 'day', 'Sep 3'],
		['2026-09', 'month', 'Sep 2026'],
	] as const)('formats the %s UTC bucket without shifting it', (value, granularity, expected) => {
		expect(formatUsageBucketLabel(value, granularity)).toBe(expected);
	});

	it('returns an invalid bucket unchanged', () => {
		expect(formatUsageBucketLabel('not-a-date', 'day')).toBe('not-a-date');
	});
});
