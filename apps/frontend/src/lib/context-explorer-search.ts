/**
 * Where the Tests drawer is, kept in the URL so the browser's back and forward buttons move through it:
 * the test whose tab is shown, or none for all the tests, and the run opened in that tab.
 */
export interface TestDrawerSearch {
	test?: string;
	testRun?: string;
}

export interface ContextExplorerSearch extends TestDrawerSearch {
	path?: string;
	from?: string;
	to?: string;
	/** Opens the Tests drawer once, as links from outside the page do, then leaves the URL. */
	tests?: 'open';
}

export interface HistoricalContextDiffTarget {
	path: string;
	from: string;
	to: string;
}

export function validateContextExplorerSearch(search: Record<string, unknown>): ContextExplorerSearch {
	return {
		...validateFileSearch(search),
		...validateTestDrawerSearch(search),
		...(search.tests === 'open' && { tests: 'open' as const }),
	};
}

export function getHistoricalContextDiffTarget(search: ContextExplorerSearch): HistoricalContextDiffTarget | null {
	return search.path && search.from && search.to ? { path: search.path, from: search.from, to: search.to } : null;
}

export function consumeHistoricalContextDiffSearch(search: ContextExplorerSearch): ContextExplorerSearch {
	const { from: _from, to: _to, ...rest } = search;
	return rest;
}

export function consumeOpenTestsSearch(search: ContextExplorerSearch): ContextExplorerSearch {
	const { tests: _tests, ...rest } = search;
	return rest;
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

function validateFileSearch(search: Record<string, unknown>): Pick<ContextExplorerSearch, 'path' | 'from' | 'to'> {
	const path = parseContextExplorerPath(search.path);
	if (!path) {
		return {};
	}
	const from = parseContextExplorerCommit(search.from);
	const to = parseContextExplorerCommit(search.to);
	return from && to ? { path, from, to } : { path };
}

function validateTestDrawerSearch(search: Record<string, unknown>): TestDrawerSearch {
	const test = parseContextExplorerPath(search.test);
	const testRun = parseTestRunId(search.testRun);
	return { ...(test && { test }), ...(testRun && { testRun }) };
}

function parseTestRunId(value: unknown): string | undefined {
	return typeof value === 'string' && /^[\w-]{1,100}$/.test(value) ? value : undefined;
}
