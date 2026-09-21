export interface ContextExplorerSearch {
	path?: string;
	from?: string;
	to?: string;
}

export interface HistoricalContextDiffTarget {
	path: string;
	from: string;
	to: string;
}

export function validateContextExplorerSearch(search: Record<string, unknown>): ContextExplorerSearch {
	const path = parseContextExplorerPath(search.path);
	if (!path) {
		return {};
	}
	const from = parseContextExplorerCommit(search.from);
	const to = parseContextExplorerCommit(search.to);
	return from && to ? { path, from, to } : { path };
}

export function getHistoricalContextDiffTarget(search: ContextExplorerSearch): HistoricalContextDiffTarget | null {
	return search.path && search.from && search.to ? { path: search.path, from: search.from, to: search.to } : null;
}

export function consumeHistoricalContextDiffSearch(search: ContextExplorerSearch): ContextExplorerSearch {
	return search.path ? { path: search.path } : {};
}

export function parseContextExplorerPath(value: unknown): string | undefined {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > 2_000 ||
		!value.startsWith('/') ||
		value.includes('\\') ||
		value.includes('\0')
	) {
		return undefined;
	}
	const segments = value.split('/').filter(Boolean);
	return segments.length > 0 && segments.every((segment) => segment !== '.' && segment !== '..') ? value : undefined;
}

export function parseContextExplorerCommit(value: unknown): string | undefined {
	return typeof value === 'string' && /^[a-f0-9]{40,64}$/i.test(value) ? value : undefined;
}
