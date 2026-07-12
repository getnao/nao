export type ScheduleFrequency = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly';

export type ScheduleConfig = {
	frequency: ScheduleFrequency;
	minute: number;
	hour: number;
	daysOfWeek: number[];
	dayOfMonth: number;
};

export const DAY_OF_WEEK_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const defaultScheduleConfig: ScheduleConfig = {
	frequency: 'weekly',
	minute: 0,
	hour: 9,
	daysOfWeek: [1],
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
			return `${minute} ${hour} * * ${formatDaysOfWeek(config.daysOfWeek)}`;
		case 'monthly':
			return `${minute} ${hour} ${clamp(config.dayOfMonth, 1, 31)} * *`;
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
		const daysOfWeek = parseDaysOfWeek(dayOfWeekField);
		if (daysOfWeek === null) {
			return null;
		}
		return { ...defaultScheduleConfig, frequency: 'weekly', minute, hour, daysOfWeek };
	}

	if (dayOfWeekField === '*') {
		const dayOfMonth = parseNumericField(dayOfMonthField, 1, 31);
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
			return `${describeDaysOfWeek(config.daysOfWeek)} at ${time}`;
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

export function normalizeDaysOfWeek(days: number[]): number[] {
	const unique = new Set(days.map((day) => (day === 7 ? 0 : day)).filter((day) => day >= 0 && day <= 6));
	return [...unique].sort((left, right) => left - right);
}

function formatDaysOfWeek(days: number[]): string {
	const normalized = normalizeDaysOfWeek(days);
	return (normalized.length > 0 ? normalized : defaultScheduleConfig.daysOfWeek).join(',');
}

function parseDaysOfWeek(field: string): number[] | null {
	const tokens = field.split(',');
	const days = new Set<number>();
	for (const token of tokens) {
		const value = parseNumericField(token, 0, 7);
		if (value === null) {
			return null;
		}
		days.add(value === 7 ? 0 : value);
	}
	return [...days].sort((left, right) => left - right);
}

function describeDaysOfWeek(days: number[]): string {
	const normalized = normalizeDaysOfWeek(days);
	if (normalized.length === 0) {
		return 'Weekly';
	}
	if (normalized.length === 7) {
		return 'Every day';
	}
	if (normalized.length === 1) {
		return `Every ${DAY_OF_WEEK_LABELS[normalized[0]]}`;
	}
	return `Every ${normalized.map((day) => DAY_OF_WEEK_LABELS[day].slice(0, 3)).join(', ')}`;
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
