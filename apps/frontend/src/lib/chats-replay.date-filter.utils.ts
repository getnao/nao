export type DateFilterValue = { mode: 'single'; value: string } | { mode: 'range'; start: string; end: string };

/** Returns YYYY-MM-DD in local time. */
export function toLocalDateString(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}
