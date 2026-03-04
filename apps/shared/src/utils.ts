export const TOOL_LABELS: Record<string, string> = {
	'tool-read': 'file',
	'tool-search': 'search',
	'tool-grep': 'search',
	'tool-list': 'folder',
	'tool-execute_sql': 'query',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => any>(func: T, delay: number): (...args: Parameters<T>) => void {
	let timeout: ReturnType<typeof setTimeout>;
	return (...args: Parameters<T>) => {
		clearTimeout(timeout);
		timeout = setTimeout(() => {
			func(...args);
		}, delay);
	};
}
