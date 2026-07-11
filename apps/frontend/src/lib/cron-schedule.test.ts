import { describe, expect, it } from 'vitest';

import { buildScheduleCron, describeCron, parseScheduleCron } from './cron-schedule';
import type { ScheduleConfig } from './cron-schedule';

const base: ScheduleConfig = { frequency: 'daily', minute: 0, hour: 9, dayOfWeek: 1, dayOfMonth: 1 };

describe('buildScheduleCron', () => {
	it('builds hourly, daily, weekdays, weekly and monthly crons', () => {
		expect(buildScheduleCron({ ...base, frequency: 'hourly', minute: 30 })).toBe('30 * * * *');
		expect(buildScheduleCron({ ...base, frequency: 'daily', hour: 9, minute: 0 })).toBe('0 9 * * *');
		expect(buildScheduleCron({ ...base, frequency: 'weekdays', hour: 8, minute: 15 })).toBe('15 8 * * 1-5');
		expect(buildScheduleCron({ ...base, frequency: 'weekly', hour: 8, minute: 0, dayOfWeek: 1 })).toBe('0 8 * * 1');
		expect(buildScheduleCron({ ...base, frequency: 'monthly', hour: 9, minute: 0, dayOfMonth: 1 })).toBe(
			'0 9 1 * *',
		);
	});
});

describe('parseScheduleCron', () => {
	it('round-trips friendly cron expressions', () => {
		for (const config of [
			{ ...base, frequency: 'hourly', minute: 30 } as const,
			{ ...base, frequency: 'daily', hour: 14, minute: 45 } as const,
			{ ...base, frequency: 'weekdays', hour: 6, minute: 0 } as const,
			{ ...base, frequency: 'weekly', hour: 8, minute: 0, dayOfWeek: 5 } as const,
			{ ...base, frequency: 'monthly', hour: 9, minute: 0, dayOfMonth: 15 } as const,
		]) {
			const parsed = parseScheduleCron(buildScheduleCron(config));
			expect(parsed?.frequency).toBe(config.frequency);
			expect(parsed?.minute).toBe(config.minute);
		}
	});

	it('normalizes Sunday expressed as 7 to 0', () => {
		expect(parseScheduleCron('0 8 * * 7')?.dayOfWeek).toBe(0);
	});

	it('returns null for expressions outside the friendly shapes', () => {
		expect(parseScheduleCron('*/5 * * * *')).toBeNull();
		expect(parseScheduleCron('0 9-17 * * *')).toBeNull();
		expect(parseScheduleCron('0 9 * 6 *')).toBeNull();
		expect(parseScheduleCron('not a cron')).toBeNull();
	});
});

describe('describeCron', () => {
	it('describes friendly crons and falls back for custom ones', () => {
		expect(describeCron('0 9 * * *')).toBe('Daily at 09:00');
		expect(describeCron('0 8 * * 1')).toBe('Every Monday at 08:00');
		expect(describeCron('30 * * * *')).toBe('Hourly at :30');
		expect(describeCron('0 9 1 * *')).toBe('Monthly on the 1st at 09:00');
		expect(describeCron('*/5 * * * *')).toBe('Custom schedule');
	});
});
