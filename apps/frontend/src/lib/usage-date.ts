import type { Granularity } from '@nao/backend/usage';

const bucketFormatters: Record<Granularity, Intl.DateTimeFormat> = {
	hour: new Intl.DateTimeFormat('en-US', {
		day: 'numeric',
		hour: '2-digit',
		hourCycle: 'h23',
		minute: '2-digit',
		month: 'short',
		timeZone: 'UTC',
	}),
	day: new Intl.DateTimeFormat('en-US', {
		day: 'numeric',
		month: 'short',
		timeZone: 'UTC',
	}),
	month: new Intl.DateTimeFormat('en-US', {
		month: 'short',
		timeZone: 'UTC',
		year: 'numeric',
	}),
};

export function formatUsageBucketLabel(value: string, granularity: Granularity): string {
	const date = parseUsageBucket(value, granularity);
	return date ? bucketFormatters[granularity].format(date) : value;
}

function parseUsageBucket(value: string, granularity: Granularity): Date | undefined {
	const isoValue = {
		hour: `${value.replace(' ', 'T')}:00Z`,
		day: `${value}T00:00:00Z`,
		month: `${value}-01T00:00:00Z`,
	}[granularity];
	const date = new Date(isoValue);
	return Number.isNaN(date.getTime()) ? undefined : date;
}
