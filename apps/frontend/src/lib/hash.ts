export function hashValue(value: string): number {
	let h = 0;
	for (let i = 0; i < value.length; i++) {
		const char = value.charCodeAt(i);
		h = (h << 5) - h + char;
		h = h & h;
	}
	return Math.abs(h);
}
