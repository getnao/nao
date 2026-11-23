import { isTestFilePath } from '@nao/shared/test-paths';

/**
 * Where the tests are, kept in the URL so the browser's back and forward buttons move through them: the test shown,
 * or none for all the tests, and the run opened with it.
 */
export interface TestDrawerSearch {
	test?: string;
	testRun?: string;
}

export interface ContextExplorerSearch extends TestDrawerSearch {
	path?: string;
	from?: string;
	to?: string;
	/** Shows all the tests: the Tests page of the doc view, or the drawer of the file tree, which then drops it. */
	tests?: 'open';
	/** The recommendation whose proposed change to the file is shown when the file opens. */
	recommendation?: string;
	/** Opens the doc view on every skill, the project's and the personal ones. */
	skills?: 'open';
}

export type DocViewTestsPage = { type: 'suite' } | { type: 'test'; path: string };

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
		...(search.skills === 'open' && { skills: 'open' as const }),
		...validateRecommendationSearch(search),
	};
}

/** Links to a past diff only make sense in the file tree, while both views show the tests. */
export function requiresFileTree(search: ContextExplorerSearch): boolean {
	return getHistoricalContextDiffTarget(search) !== null;
}

/** The tests the doc view shows in place of a file: one test, or all of them while a run of the suite is open. */
export function getDocViewTestsPage(search: ContextExplorerSearch): DocViewTestsPage | null {
	if (search.test && isTestFilePath(search.test)) {
		return { type: 'test', path: search.test };
	}
	return search.tests === 'open' || search.testRun ? { type: 'suite' } : null;
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
	const testRun = parseIdentifier(search.testRun);
	return { ...(test && { test }), ...(testRun && { testRun }) };
}

function validateRecommendationSearch(search: Record<string, unknown>): Pick<ContextExplorerSearch, 'recommendation'> {
	const recommendation = parseIdentifier(search.recommendation);
	return recommendation && parseContextExplorerPath(search.path) ? { recommendation } : {};
}

function parseIdentifier(value: unknown): string | undefined {
	return typeof value === 'string' && /^[\w-]{1,100}$/.test(value) ? value : undefined;
}
