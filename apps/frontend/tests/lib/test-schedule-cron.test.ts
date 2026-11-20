import { describe, expect, it } from 'vitest';

import type { SchedulePick } from '@/lib/test-schedule-cron';
import {
	buildScheduleCron,
	describeScheduleCron,
	isCompleteSchedulePick,
	parseScheduleCron,
} from '@/lib/test-schedule-cron';

const PICK: SchedulePick = { frequency: 'daily', time: '06:00', weekday: 1, cron: '' };

describe('test schedule cron', () => {
	it.each([
		{ pick: { frequency: 'hourly' as const }, cron: '0 * * * *', description: 'Every hour' },
		{ pick: { frequency: 'daily' as const }, cron: '0 6 * * *', description: 'Every day at 06:00' },
		{
			pick: { frequency: 'weekdays' as const, time: '18:45' },
			cron: '45 18 * * 1-5',
			description: 'Weekdays at 18:45',
		},
		{
			pick: { frequency: 'weekly' as const, time: '08:30', weekday: 3 },
			cron: '30 8 * * 3',
			description: 'Every Wednesday at 08:30',
		},
		{
			pick: { frequency: 'weekly' as const, weekday: 0 },
			cron: '0 6 * * 0',
			description: 'Every Sunday at 06:00',
		},
		{
			pick: { frequency: 'custom' as const, cron: ' 0 2 1 * * ' },
			cron: '0 2 1 * *',
			description: '0 2 1 * *',
		},
	])('builds $cron, read back as "$description"', ({ pick, cron, description }) => {
		expect(buildScheduleCron({ ...PICK, ...pick })).toBe(cron);
		expect(describeScheduleCron(cron)).toBe(description);
		expect(buildScheduleCron(parseScheduleCron(cron))).toBe(cron);
		expect(parseScheduleCron(cron).frequency).toBe(pick.frequency);
	});

	it.each([
		{ pick: { frequency: 'daily' as const, time: '' }, isComplete: false },
		{ pick: { frequency: 'hourly' as const, time: '' }, isComplete: true },
		{ pick: { frequency: 'custom' as const, cron: '  ' }, isComplete: false },
		{ pick: { frequency: 'custom' as const, cron: '0 2 1 * *' }, isComplete: true },
	])('tells whether $pick can be saved: $isComplete', ({ pick, isComplete }) => {
		expect(isCompleteSchedulePick({ ...PICK, ...pick })).toBe(isComplete);
	});
});
