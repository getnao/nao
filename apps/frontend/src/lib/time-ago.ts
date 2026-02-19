export interface TimeAgo {
	value: number;
	unit: 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';
	humanReadable: string;
}

export function getTimeAgo(timestamp: number): TimeAgo {
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
		return { value: years, unit: 'year', humanReadable: `${years}y ago` };
	}
	if (months > 0) {
		return { value: months, unit: 'month', humanReadable: `${months}mo ago` };
	}
	if (weeks > 0) {
		return { value: weeks, unit: 'week', humanReadable: `${weeks}w ago` };
	}
	if (days > 0) {
		return { value: days, unit: 'day', humanReadable: `${days}d ago` };
	}
	if (hours > 0) {
		return { value: hours, unit: 'hour', humanReadable: `${hours}h ago` };
	}
	if (minutes > 0) {
		return { value: minutes, unit: 'minute', humanReadable: `${minutes}m ago` };
	}
	return { value: seconds, unit: 'second', humanReadable: 'Just now' };
}
