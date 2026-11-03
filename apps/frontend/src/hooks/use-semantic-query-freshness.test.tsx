// @vitest-environment jsdom

import { QueryClient, QueryClientProvider, skipToken } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useRecheckSemanticQueryFreshness, useSemanticQueryFreshness } from './use-semantic-query-freshness';
import type { ReactNode } from 'react';
import type { SavedSemanticQuery } from './use-semantic-query-freshness';

const mocks = vi.hoisted(() => ({
	compile: vi.fn<() => Promise<{ sql: string }>>(),
}));

vi.mock('@/main', () => ({
	trpc: {
		sql: {
			compileSemanticQuery: {
				queryOptions: (input: unknown) => ({
					queryKey: ['compileSemanticQuery', input],
					queryFn: input === skipToken ? skipToken : () => mocks.compile(),
				}),
				pathFilter: () => ({ queryKey: ['compileSemanticQuery'] }),
			},
		},
	},
}));

const SAVED_SQL = "SELECT SUM(amount) AS revenue FROM orders WHERE region = 'North  America'";

let queryClient: QueryClient;

beforeEach(() => {
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } } });
});

afterEach(() => {
	cleanup();
	queryClient.clear();
	mocks.compile.mockReset();
});

it('reads the result as current when the layer still compiles the saved SQL', async () => {
	mocks.compile.mockResolvedValue({ sql: `\n${SAVED_SQL}\n` });

	const { result } = renderFreshness(savedQuery(SAVED_SQL));

	await waitFor(() => expect(result.current.status).toBe('current'));
});

it('notices a definition change inside a SQL string value', async () => {
	mocks.compile.mockResolvedValue({ sql: SAVED_SQL.replace('North  America', 'North America') });

	const { result } = renderFreshness(savedQuery(SAVED_SQL));

	await waitFor(() => expect(result.current.status).toBe('outdated'));
});

it('compiles again when the editor opens again, despite the default cache time', async () => {
	mocks.compile.mockResolvedValue({ sql: SAVED_SQL });
	const firstOpen = renderFreshness(savedQuery(SAVED_SQL));
	await waitFor(() => expect(firstOpen.result.current.status).toBe('current'));
	firstOpen.unmount();

	mocks.compile.mockResolvedValue({ sql: 'SELECT SUM(net_amount) AS revenue FROM orders' });
	const secondOpen = renderFreshness(savedQuery(SAVED_SQL));

	await waitFor(() => expect(secondOpen.result.current.status).toBe('outdated'));
});

it('checks again after a save instead of comparing the new SQL with an old compile', async () => {
	const newSql = 'SELECT SUM(net_amount) AS revenue FROM orders';
	mocks.compile.mockResolvedValue({ sql: newSql });
	const { result, rerender } = renderFreshnessWithRecheck(savedQuery(SAVED_SQL));
	await waitFor(() => expect(result.current.freshness.status).toBe('outdated'));

	rerender({ saved: savedQuery(newSql) });
	act(() => result.current.recheck());

	await waitFor(() => expect(result.current.freshness.status).toBe('current'));
});

it('clears a compile error once a save succeeds', async () => {
	mocks.compile.mockRejectedValue(new Error("Unknown metric 'revenue'"));
	const { result } = renderFreshnessWithRecheck(savedQuery(SAVED_SQL));
	await waitFor(() => expect(result.current.freshness.status).toBe('broken'));

	mocks.compile.mockResolvedValue({ sql: SAVED_SQL });
	act(() => result.current.recheck());

	await waitFor(() => expect(result.current.freshness.status).toBe('current'));
});

it('does not compile without a saved query', () => {
	const { result } = renderFreshness(null);

	expect(result.current.status).toBe('unknown');
	expect(mocks.compile).not.toHaveBeenCalled();
});

function savedQuery(compiledSql: string): SavedSemanticQuery {
	return { queryId: 'query_sem1', semanticQuery: { metrics: ['revenue'] }, compiledSql };
}

function renderFreshness(saved: SavedSemanticQuery | null) {
	return renderHook(() => useSemanticQueryFreshness(saved), { wrapper: QueryWrapper });
}

function renderFreshnessWithRecheck(saved: SavedSemanticQuery) {
	return renderHook(
		(props: { saved: SavedSemanticQuery }) => ({
			freshness: useSemanticQueryFreshness(props.saved),
			recheck: useRecheckSemanticQueryFreshness(),
		}),
		{ wrapper: QueryWrapper, initialProps: { saved } },
	);
}

function QueryWrapper({ children }: { children: ReactNode }) {
	return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
