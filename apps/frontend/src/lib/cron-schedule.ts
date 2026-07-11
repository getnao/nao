export type ScheduleFrequency = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly';

export type ScheduleConfig = {
	frequency: ScheduleFrequency;
	minute: number;
	hour: number;
	dayOfWeek: number;
	dayOfMonth: number;
};

export const DAY_OF_WEEK_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const defaultScheduleConfig: ScheduleConfig = {
	frequency: 'weekly',
	minute: 0,
	hour: 9,
	dayOfWeek: 1,
	dayOfMonth: 1,
};

export function buildScheduleCron(config: ScheduleConfig): string {
	const minute = clamp(config.minute, 0, 59);
	const hour = clamp(config.hour, 0, 23);

	switch (config.frequency) {
		case 'hourly':
			return `${minute} * * * *`;
		case 'daily':
			return `${minute} ${hour} * * *`;
		case 'weekdays':
			return `${minute} ${hour} * * 1-5`;
		case 'weekly':
			return `${minute} ${hour} * * ${clamp(config.dayOfWeek, 0, 6)}`;
		case 'monthly':
			return `${minute} ${hour} ${clamp(config.dayOfMonth, 1, 28)} * *`;
	}
}

/**
 * Parse a cron expression back into a friendly schedule config. Returns null
 * when the expression does not match one of the friendly shapes, signalling the
 * UI to fall back to the advanced (raw cron) editor.
 */
export function parseScheduleCron(cron: string): ScheduleConfig | null {
	const fields = cron.trim().split(/\s+/);
	if (fields.length !== 5) {
		return null;
	}

	const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] = fields;
	if (monthField !== '*') {
		return null;
	}

	const minute = parseNumericField(minuteField, 0, 59);
	if (minute === null) {
		return null;
	}

	if (hourField === '*') {
		return dayOfMonthField === '*' && dayOfWeekField === '*'
			? { ...defaultScheduleConfig, frequency: 'hourly', minute }
			: null;
	}

	const hour = parseNumericField(hourField, 0, 23);
	if (hour === null) {
		return null;
	}

	if (dayOfMonthField === '*' && dayOfWeekField === '*') {
		return { ...defaultScheduleConfig, frequency: 'daily', minute, hour };
	}

	if (dayOfMonthField === '*' && dayOfWeekField === '1-5') {
		return { ...defaultScheduleConfig, frequency: 'weekdays', minute, hour };
	}

	if (dayOfMonthField === '*') {
		const dayOfWeek = parseNumericField(dayOfWeekField, 0, 7);
		if (dayOfWeek === null) {
			return null;
		}
		return { ...defaultScheduleConfig, frequency: 'weekly', minute, hour, dayOfWeek: dayOfWeek === 7 ? 0 : dayOfWeek };
	}

	if (dayOfWeekField === '*') {
		const dayOfMonth = parseNumericField(dayOfMonthField, 1, 28);
		if (dayOfMonth === null) {
			return null;
		}
		return { ...defaultScheduleConfig, frequency: 'monthly', minute, hour, dayOfMonth };
	}

	return null;
}

export function describeSchedule(config: ScheduleConfig): string {
	const time = formatTime(config.hour, config.minute);

	switch (config.frequency) {
		case 'hourly':
			return `Hourly at :${padTwo(config.minute)}`;
		case 'daily':
			return `Daily at ${time}`;
		case 'weekdays':
			return `Weekdays at ${time}`;
		case 'weekly':
			return `Every ${DAY_OF_WEEK_LABELS[config.dayOfWeek] ?? 'day'} at ${time}`;
		case 'monthly':
			return `Monthly on the ${formatOrdinal(config.dayOfMonth)} at ${time}`;
	}
}

export function describeCron(cron: string): string {
	const config = parseScheduleCron(cron);
	return config ? describeSchedule(config) : 'Custom schedule';
}

export function formatTime(hour: number, minute: number): string {
	return `${padTwo(hour)}:${padTwo(minute)}`;
}

function parseNumericField(field: string, min: number, max: number): number | null {
	if (!/^\d+$/.test(field)) {
		return null;
	}
	const value = Number(field);
	return value >= min && value <= max ? value : null;
}

function formatOrdinal(day: number): string {
	const remainderTen = day % 10;
	const remainderHundred = day % 100;
	if (remainderTen === 1 && remainderHundred !== 11) {
		return `${day}st`;
	}
	if (remainderTen === 2 && remainderHundred !== 12) {
		return `${day}nd`;
	}
	if (remainderTen === 3 && remainderHundred !== 13) {
		return `${day}rd`;
	}
	return `${day}th`;
}

function padTwo(value: number): string {
	return value.toString().padStart(2, '0');
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
