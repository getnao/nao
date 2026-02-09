// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => any>(func: T, delay: number): (...args: Parameters<T>) => void {
	return (...args: Parameters<T>) => {
		setTimeout(() => {
			func(...args);
		}, delay);
	};
}
