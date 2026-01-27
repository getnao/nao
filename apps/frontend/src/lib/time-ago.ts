export interface TimeAgoResult {
	value: number;
	unit: 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';
}

export function getTimeAgo(timestamp: number): TimeAgoResult & { humanReadable: string } {
	const timeAgo = calculateTimeAgo(timestamp);
	return {
		...timeAgo,
		humanReadable: formatTimeAgo(timeAgo),
	};
}

export function calculateTimeAgo(timestamp: number): TimeAgoResult {
	const now = Date.now();
	const diff = now - timestamp;

	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	const weeks = Math.floor(days / 7);
	const months = Math.floor(days / 30);
	const years = Math.floor(days / 365);

	if (years > 0) {
		return { value: years, unit: 'year' };
	}
	if (months > 0) {
		return { value: months, unit: 'month' };
	}
	if (weeks > 0) {
		return { value: weeks, unit: 'week' };
	}
	if (days > 0) {
		return { value: days, unit: 'day' };
	}
	if (hours > 0) {
		return { value: hours, unit: 'hour' };
	}
	if (minutes > 0) {
		return { value: minutes, unit: 'minute' };
	}
	return { value: seconds, unit: 'second' };
}

export function formatTimeAgo(result: TimeAgoResult): string {
	switch (result.unit) {
		case 'second':
			return `Just now`;
		case 'minute':
			return `${result.value}m ago`;
		case 'hour':
			return `${result.value}h ago`;
		case 'day':
			return `${result.value}d ago`;
		case 'week':
			return `${result.value}w ago`;
		case 'month':
			return `${result.value}m ago`;
		case 'year':
			return `${result.value}y ago`;
	}
}
