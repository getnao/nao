// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_USAGE_PERIOD_PREFERENCE } from '@nao/backend/usage';
import { useUsagePeriodPreferences } from './use-usage-period-preferences';
import type { UsageRouteSearch } from '@/components/settings/usage-route-search';
import { DEFAULT_USAGE_SEARCH } from '@/components/settings/usage-route-search';

const mocks = vi.hoisted(() => ({
	getSettings: vi.fn(),
	updatePreference: vi.fn(),
	createEntry: vi.fn(),
	updateEntry: vi.fn(),
	deleteEntry: vi.fn(),
	settingsQueryOptions: vi.fn(),
}));

vi.mock('@/main', () => ({
	trpc: {
		usage: {
			getPeriodSettings: {
				queryOptions: mocks.settingsQueryOptions,
			},
			updatePeriodPreference: {
				mutationOptions: (options: object) => ({ mutationFn: mocks.updatePreference, ...options }),
			},
			createPeriodEntry: {
				mutationOptions: (options: object) => ({ mutationFn: mocks.createEntry, ...options }),
			},
			updatePeriodEntry: {
				mutationOptions: (options: object) => ({ mutationFn: mocks.updateEntry, ...options }),
			},
			deletePeriodEntry: {
				mutationOptions: (options: object) => ({ mutationFn: mocks.deleteEntry, ...options }),
			},
		},
	},
}));

describe('useUsagePeriodPreferences', () => {
	beforeEach(() => {
		localStorage.clear();
		localStorage.setItem('nao.active-project-id', JSON.stringify('project-a'));
		mocks.getSettings.mockResolvedValue({
			preference: DEFAULT_USAGE_PERIOD_PREFERENCE,
			entries: [{ id: 'year', days: 365, granularity: 'month' }],
		});
		mocks.updatePreference.mockResolvedValue(DEFAULT_USAGE_PERIOD_PREFERENCE);
		mocks.createEntry.mockResolvedValue({ id: 'created', days: 30, granularity: 'day' });
		mocks.updateEntry.mockImplementation(async ({ entry }) => entry);
		mocks.deleteEntry.mockResolvedValue({ id: 'year', usagePeriod: DEFAULT_USAGE_PERIOD_PREFERENCE });
		mocks.settingsQueryOptions.mockImplementation((input) => ({
			queryKey: [['usage', 'getPeriodSettings'], { input }],
			queryFn: () => mocks.getSettings(input),
		}));
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it('waits for saved entries and scopes queries by project', async () => {
		let resolveSettings: (value: unknown) => void = () => undefined;
		mocks.getSettings.mockReturnValue(
			new Promise((resolve) => {
				resolveSettings = resolve;
			}),
		);
		const onUpdateSearch = vi.fn();
		const { rerenderHarness } = renderHarness(onUpdateSearch);

		expect(screen.getByTestId('status').textContent).toBe('loading');
		expect(mocks.settingsQueryOptions).toHaveBeenCalledWith({ projectId: 'project-a' });

		await act(async () => {
			resolveSettings({
				preference: DEFAULT_USAGE_PERIOD_PREFERENCE,
				entries: [{ id: 'year', days: 365, granularity: 'month' }],
			});
		});
		await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));

		localStorage.setItem('nao.active-project-id', JSON.stringify('project-b'));
		rerenderHarness(1);
		await waitFor(() => expect(mocks.settingsQueryOptions).toHaveBeenLastCalledWith({ projectId: 'project-b' }));
	});

	it('restores URL state when preference persistence fails', async () => {
		mocks.updatePreference.mockRejectedValue(new Error('Save failed'));
		const onUpdateSearch = vi.fn();
		renderHarness(onUpdateSearch);
		await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));

		fireEvent.click(screen.getByRole('button', { name: 'Select saved period' }));

		await waitFor(() => expect(onUpdateSearch).toHaveBeenCalledTimes(2));
		expect(onUpdateSearch.mock.calls[0][0]).toMatchObject({ periodEntryId: 'year', periodMode: undefined });
		expect(onUpdateSearch.mock.calls[1][0]).toMatchObject({ periodEntryId: undefined, periodMode: '15d' });
		expect(screen.getByRole('alert').textContent).toBe('Save failed');
	});

	it('migrates legacy preferences once per project', async () => {
		localStorage.setItem('nao.usage-filters.project-a', JSON.stringify({ periodMode: '6m' }));
		localStorage.setItem('nao.usage-filters.project-b', JSON.stringify({ periodMode: '24h' }));
		mocks.getSettings.mockResolvedValue({ preference: null, entries: [] });
		const onUpdateSearch = vi.fn();
		const { rerenderHarness } = renderHarness(onUpdateSearch);

		await waitFor(() =>
			expect(mocks.updatePreference.mock.calls[0]?.[0]).toEqual({
				projectId: 'project-a',
				preference: { mode: '6m' },
			}),
		);

		localStorage.setItem('nao.active-project-id', JSON.stringify('project-b'));
		rerenderHarness(1);

		await waitFor(() =>
			expect(mocks.updatePreference.mock.calls[1]?.[0]).toEqual({
				projectId: 'project-b',
				preference: { mode: '24h' },
			}),
		);
	});

	it('does not automatically retry a failed legacy migration', async () => {
		localStorage.setItem('nao.usage-filters.project-a', JSON.stringify({ periodMode: '6m' }));
		mocks.getSettings.mockResolvedValue({ preference: null, entries: [] });
		mocks.updatePreference.mockRejectedValue(new Error('Migration failed'));
		renderHarness(vi.fn());

		expect((await screen.findByRole('alert')).textContent).toBe('Migration failed');
		await act(async () => Promise.resolve());
		expect(mocks.updatePreference).toHaveBeenCalledTimes(1);

		fireEvent.click(screen.getByRole('button', { name: 'Retry migration' }));
		await waitFor(() => expect(mocks.updatePreference).toHaveBeenCalledTimes(2));
	});

	it('clears a stale period entry id after entries load', async () => {
		const onUpdateSearch = vi.fn();
		renderHarness(onUpdateSearch, { ...DEFAULT_USAGE_SEARCH, periodEntryId: 'missing' });

		await waitFor(() => expect(onUpdateSearch).toHaveBeenCalledWith({ periodEntryId: undefined }));
	});

	it('does not update the new project URL when an old create completes', async () => {
		let resolveCreate: (entry: { id: string; days: number; granularity: 'day' }) => void = () => undefined;
		mocks.createEntry.mockReturnValue(
			new Promise((resolve) => {
				resolveCreate = resolve;
			}),
		);
		const onUpdateSearch = vi.fn();
		const { rerenderHarness } = renderHarness(onUpdateSearch);
		await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));

		fireEvent.click(screen.getByRole('button', { name: 'Create period' }));
		localStorage.setItem('nao.active-project-id', JSON.stringify('project-b'));
		rerenderHarness(1);
		await act(async () => resolveCreate({ id: 'created', days: 30, granularity: 'day' }));

		expect(onUpdateSearch).not.toHaveBeenCalled();
	});

	it('does not roll back the new project URL when an old selection fails', async () => {
		let rejectUpdate: (cause: Error) => void = () => undefined;
		mocks.updatePreference.mockReturnValue(
			new Promise((_resolve, reject) => {
				rejectUpdate = reject;
			}),
		);
		const onUpdateSearch = vi.fn();
		const { rerenderHarness } = renderHarness(onUpdateSearch);
		await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));

		fireEvent.click(screen.getByRole('button', { name: 'Select saved period' }));
		localStorage.setItem('nao.active-project-id', JSON.stringify('project-b'));
		rerenderHarness(1);
		await act(async () => rejectUpdate(new Error('Save failed')));

		expect(onUpdateSearch).toHaveBeenCalledTimes(1);
	});

	it('does not reset the new project URL when an old delete completes', async () => {
		let resolveDelete: (result: { id: string; usagePeriod: typeof DEFAULT_USAGE_PERIOD_PREFERENCE }) => void = () =>
			undefined;
		mocks.deleteEntry.mockReturnValue(
			new Promise((resolve) => {
				resolveDelete = resolve;
			}),
		);
		const onUpdateSearch = vi.fn();
		const { rerenderHarness } = renderHarness(onUpdateSearch, {
			...DEFAULT_USAGE_SEARCH,
			periodEntryId: 'year',
		});
		await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));

		fireEvent.click(screen.getByRole('button', { name: 'Delete period' }));
		localStorage.setItem('nao.active-project-id', JSON.stringify('project-b'));
		rerenderHarness(1);
		await act(async () =>
			resolveDelete({
				id: 'year',
				usagePeriod: DEFAULT_USAGE_PERIOD_PREFERENCE,
			}),
		);

		expect(onUpdateSearch).not.toHaveBeenCalled();
	});
});

function renderHarness(
	onUpdateSearch: (next: Partial<UsageRouteSearch>) => void,
	usageSearch: UsageRouteSearch = DEFAULT_USAGE_SEARCH,
) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
	const result = render(
		<QueryClientProvider client={queryClient}>
			<Harness onUpdateSearch={onUpdateSearch} revision={0} usageSearch={usageSearch} />
		</QueryClientProvider>,
	);
	return {
		...result,
		rerenderHarness(revision: number) {
			result.rerender(
				<QueryClientProvider client={queryClient}>
					<Harness onUpdateSearch={onUpdateSearch} revision={revision} usageSearch={usageSearch} />
				</QueryClientProvider>,
			);
		},
	};
}

function Harness({
	onUpdateSearch,
	revision,
	usageSearch,
}: {
	onUpdateSearch: (next: Partial<UsageRouteSearch>) => void;
	revision: number;
	usageSearch: UsageRouteSearch;
}) {
	const state = useUsagePeriodPreferences({ canViewUsage: true, usageSearch, onUpdateSearch });

	return (
		<div data-revision={revision}>
			<div data-testid='status'>{state.isReady ? 'ready' : state.isLoading ? 'loading' : 'error'}</div>
			{state.error && <div role='alert'>{state.error}</div>}
			<button
				type='button'
				onClick={() => {
					void state.selectPreference({ mode: 'saved', entryId: 'year' }).catch(() => undefined);
				}}
			>
				Select saved period
			</button>
			<button
				type='button'
				onClick={() => {
					void state.createEntry({ days: 30, granularity: 'day' });
				}}
			>
				Create period
			</button>
			<button
				type='button'
				onClick={() => {
					void state.deleteEntry('year');
				}}
			>
				Delete period
			</button>
			{state.retry && (
				<button type='button' onClick={state.retry}>
					Retry migration
				</button>
			)}
		</div>
	);
}
