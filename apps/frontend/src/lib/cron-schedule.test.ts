import { describe, expect, it } from 'vitest';

import { buildScheduleCron, describeCron, parseScheduleCron } from './cron-schedule';
import type { ScheduleConfig } from './cron-schedule';

const base: ScheduleConfig = { frequency: 'daily', minute: 0, hour: 9, daysOfWeek: [1], dayOfMonth: 1 };

describe('buildScheduleCron', () => {
	it('builds hourly, daily, weekdays, weekly and monthly crons', () => {
		expect(buildScheduleCron({ ...base, frequency: 'hourly', minute: 30 })).toBe('30 * * * *');
		expect(buildScheduleCron({ ...base, frequency: 'daily', hour: 9, minute: 0 })).toBe('0 9 * * *');
		expect(buildScheduleCron({ ...base, frequency: 'weekdays', hour: 8, minute: 15 })).toBe('15 8 * * 1-5');
		expect(buildScheduleCron({ ...base, frequency: 'weekly', hour: 8, minute: 0, daysOfWeek: [1] })).toBe(
			'0 8 * * 1',
		);
		expect(buildScheduleCron({ ...base, frequency: 'weekly', hour: 8, minute: 0, daysOfWeek: [5, 1, 3] })).toBe(
			'0 8 * * 1,3,5',
		);
		expect(buildScheduleCron({ ...base, frequency: 'monthly', hour: 9, minute: 0, dayOfMonth: 1 })).toBe(
			'0 9 1 * *',
		);
	});
});

describe('parseScheduleCron', () => {
	it('round-trips friendly cron expressions across every relevant field', () => {
		const cases: Array<{ config: ScheduleConfig; fields: Array<keyof ScheduleConfig> }> = [
			{ config: { ...base, frequency: 'hourly', minute: 37 }, fields: ['frequency', 'minute'] },
			{ config: { ...base, frequency: 'daily', hour: 14, minute: 45 }, fields: ['frequency', 'hour', 'minute'] },
			{ config: { ...base, frequency: 'weekdays', hour: 6, minute: 0 }, fields: ['frequency', 'hour', 'minute'] },
			{
				config: { ...base, frequency: 'weekly', hour: 8, minute: 0, daysOfWeek: [5] },
				fields: ['frequency', 'hour', 'minute', 'daysOfWeek'],
			},
			{
				config: { ...base, frequency: 'weekly', hour: 8, minute: 0, daysOfWeek: [1, 3, 5] },
				fields: ['frequency', 'hour', 'minute', 'daysOfWeek'],
			},
			{
				config: { ...base, frequency: 'monthly', hour: 9, minute: 0, dayOfMonth: 15 },
				fields: ['frequency', 'hour', 'minute', 'dayOfMonth'],
			},
			{
				config: { ...base, frequency: 'monthly', hour: 23, minute: 5, dayOfMonth: 31 },
				fields: ['frequency', 'hour', 'minute', 'dayOfMonth'],
			},
		];

		for (const { config, fields } of cases) {
			const parsed = parseScheduleCron(buildScheduleCron(config));
			expect(parsed).not.toBeNull();
			for (const field of fields) {
				expect(parsed?.[field]).toEqual(config[field]);
			}
		}
	});

	it('parses a weekly multi-day list', () => {
		expect(parseScheduleCron('0 8 * * 1,3,5')?.daysOfWeek).toEqual([1, 3, 5]);
	});

	it('keeps 1-5 as Weekdays but comma lists as Weekly', () => {
		expect(parseScheduleCron('0 8 * * 1-5')?.frequency).toBe('weekdays');
		expect(parseScheduleCron('0 8 * * 1,2,3,4,5')?.frequency).toBe('weekly');
	});

	it('normalizes Sunday expressed as 7 to 0', () => {
		expect(parseScheduleCron('0 8 * * 7')?.daysOfWeek).toEqual([0]);
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
		expect(describeCron('0 8 * * 1,3,5')).toBe('Every Mon, Wed, Fri at 08:00');
		expect(describeCron('37 * * * *')).toBe('Hourly at :37');
		expect(describeCron('0 9 1 * *')).toBe('Monthly on the 1st at 09:00');
		expect(describeCron('*/5 * * * *')).toBe('Custom schedule');
	});
});
