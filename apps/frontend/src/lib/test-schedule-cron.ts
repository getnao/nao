export type ScheduleFrequency = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom';

/** What the schedule form picks, turned into the cron the schedule is saved with. */
export interface SchedulePick {
	frequency: ScheduleFrequency;
	/** `HH:MM`, which an hourly or custom schedule does not use. */
	time: string;
	/** The day of a weekly schedule, 0 for Sunday as in a cron. */
	weekday: number;
	/** The expression of a custom schedule. */
	cron: string;
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** What the form of a new schedule starts from. */
export const NEW_SCHEDULE_PICK: SchedulePick = { frequency: 'daily', time: '06:00', weekday: 1, cron: '' };

const HOURLY_CRON = '0 * * * *';
const DAYS_OF_FREQUENCY = { daily: '*', weekdays: '1-5' };

export function isCompleteSchedulePick(pick: SchedulePick): boolean {
	if (pick.frequency === 'custom') {
		return pick.cron.trim().length > 0;
	}
	return pick.frequency === 'hourly' || /^\d{2}:\d{2}$/.test(pick.time);
}

export function buildScheduleCron(pick: SchedulePick): string {
	if (pick.frequency === 'custom') {
		return pick.cron.trim();
	}
	if (pick.frequency === 'hourly') {
		return HOURLY_CRON;
	}
	const [hours, minutes] = pick.time.split(':').map(Number);
	const days = pick.frequency === 'weekly' ? pick.weekday : DAYS_OF_FREQUENCY[pick.frequency];
	return `${minutes} ${hours} * * ${days}`;
}

/** The pick that builds a saved cron, for the form to edit it, else a custom schedule with the expression. */
export function parseScheduleCron(cron: string): SchedulePick {
	const expression = cron.trim();
	const pick = { ...NEW_SCHEDULE_PICK, frequency: 'custom' as const };
	if (expression === HOURLY_CRON) {
		return { ...pick, frequency: 'hourly' };
	}
	const fields = expression.match(/^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-7])$/);
	if (!fields) {
		return { ...pick, cron: expression };
	}
	const [, minutes, hours, days] = fields;
	const timed = { ...pick, time: `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}` };
	if (days === '*') {
		return { ...timed, frequency: 'daily' };
	}
	return days === '1-5'
		? { ...timed, frequency: 'weekdays' }
		: { ...timed, frequency: 'weekly', weekday: Number(days) % 7 };
}

/** "Every Monday at 08:00" for the schedules the form builds, else the expression itself. */
export function describeScheduleCron(cron: string): string {
	const pick = parseScheduleCron(cron);
	switch (pick.frequency) {
		case 'custom':
			return pick.cron;
		case 'hourly':
			return 'Every hour';
		case 'daily':
			return `Every day at ${pick.time}`;
		case 'weekdays':
			return `Weekdays at ${pick.time}`;
		case 'weekly':
			return `Every ${WEEKDAYS[pick.weekday]} at ${pick.time}`;
	}
}
