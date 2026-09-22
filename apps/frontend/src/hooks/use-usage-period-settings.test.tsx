// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_USAGE_PERIOD_SELECTION } from '@nao/backend/usage';
import { useUsagePeriodSettings } from './use-usage-period-settings';
import type { UsageRouteSearch } from '@/components/settings/usage-route-search';
import {
	DEFAULT_USAGE_SEARCH,
	readStoredUsagePeriodSelection,
	saveUsageFilters,
} from '@/components/settings/usage-route-search';

const mocks = vi.hoisted(() => ({
	getSettings: vi.fn(),
	updateSelection: vi.fn(),
	createSavedPeriod: vi.fn(),
	updateSavedPeriod: vi.fn(),
	deleteSavedPeriod: vi.fn(),
	settingsQueryOptions: vi.fn(),
}));

vi.mock('@/main', () => ({
	trpc: {
		usage: {
			getPeriodSettings: {
				queryOptions: mocks.settingsQueryOptions,
			},
			updatePeriodSelection: {
				mutationOptions: (options: object) => ({ mutationFn: mocks.updateSelection, ...options }),
			},
			createSavedPeriod: {
				mutationOptions: (options: object) => ({ mutationFn: mocks.createSavedPeriod, ...options }),
			},
			updateSavedPeriod: {
				mutationOptions: (options: object) => ({ mutationFn: mocks.updateSavedPeriod, ...options }),
			},
			deleteSavedPeriod: {
				mutationOptions: (options: object) => ({ mutationFn: mocks.deleteSavedPeriod, ...options }),
			},
		},
	},
}));

describe('useUsagePeriodSettings', () => {
	beforeEach(() => {
		localStorage.clear();
		localStorage.setItem('nao.active-project-id', JSON.stringify('project-a'));
		mocks.getSettings.mockResolvedValue({
			selection: DEFAULT_USAGE_PERIOD_SELECTION,
			savedPeriods: [{ id: 'year', days: 365, granularity: 'month' }],
		});
		mocks.updateSelection.mockResolvedValue(DEFAULT_USAGE_PERIOD_SELECTION);
		mocks.createSavedPeriod.mockResolvedValue({ id: 'created', days: 30, granularity: 'day' });
		mocks.updateSavedPeriod.mockImplementation(async ({ savedPeriod }) => savedPeriod);
		mocks.deleteSavedPeriod.mockResolvedValue({ id: 'year', selection: DEFAULT_USAGE_PERIOD_SELECTION });
		mocks.settingsQueryOptions.mockImplementation((input) => ({
			queryKey: [['usage', 'getPeriodSettings'], { input }],
			queryFn: () => mocks.getSettings(input),
		}));
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it('waits for saved periods and scopes queries by project', async () => {
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
				selection: DEFAULT_USAGE_PERIOD_SELECTION,
				savedPeriods: [{ id: 'year', days: 365, granularity: 'month' }],
			});
		});
		await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));

		localStorage.setItem('nao.active-project-id', JSON.stringify('project-b'));
		rerenderHarness(1);
		await waitFor(() => expect(mocks.settingsQueryOptions).toHaveBeenLastCalledWith({ projectId: 'project-b' }));
	});

	it('restores URL state when selection persistence fails', async () => {
		mocks.updateSelection.mockRejectedValue(new Error('Save failed'));
		const onUpdateSearch = vi.fn();
		renderHarness(onUpdateSearch);
		await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));

		fireEvent.click(screen.getByRole('button', { name: 'Select saved period' }));

		await waitFor(() => expect(onUpdateSearch).toHaveBeenCalledTimes(2));
		expect(onUpdateSearch.mock.calls[0][0]).toMatchObject({ savedPeriodId: 'year', periodMode: undefined });
		expect(onUpdateSearch.mock.calls[1][0]).toMatchObject({ savedPeriodId: undefined, periodMode: '15d' });
		expect(screen.getByRole('alert').textContent).toBe('Save failed');
	});

	it('migrates legacy selections once per project', async () => {
		localStorage.setItem('nao.usage-filters.project-a', JSON.stringify({ periodMode: '6m' }));
		localStorage.setItem('nao.usage-filters.project-b', JSON.stringify({ periodMode: '24h' }));
		mocks.getSettings.mockResolvedValue({ selection: null, savedPeriods: [] });
		const onUpdateSearch = vi.fn();
		const { rerenderHarness } = renderHarness(onUpdateSearch);

		await waitFor(() =>
			expect(mocks.updateSelection.mock.calls[0]?.[0]).toEqual({
				projectId: 'project-a',
				selection: { mode: '6m' },
			}),
		);

		localStorage.setItem('nao.active-project-id', JSON.stringify('project-b'));
		rerenderHarness(1);

		await waitFor(() =>
			expect(mocks.updateSelection.mock.calls[1]?.[0]).toEqual({
				projectId: 'project-b',
				selection: { mode: '24h' },
			}),
		);
	});

	it('clears a legacy period when the server already has a selection', async () => {
		localStorage.setItem('nao.usage-filters.project-a', JSON.stringify({ periodMode: '6m' }));
		mocks.getSettings.mockResolvedValue({ selection: { mode: '24h' }, savedPeriods: [] });

		renderHarness(vi.fn());

		await waitFor(() => expect(readStoredUsagePeriodSelection('project-a')).toBeUndefined());
		expect(mocks.updateSelection).not.toHaveBeenCalled();
	});

	it('does not automatically retry a failed legacy migration', async () => {
		localStorage.setItem('nao.usage-filters.project-a', JSON.stringify({ periodMode: '6m' }));
		mocks.getSettings.mockResolvedValue({ selection: null, savedPeriods: [] });
		mocks.updateSelection.mockRejectedValue(new Error('Migration failed'));
		renderHarness(vi.fn());

		expect((await screen.findByRole('alert')).textContent).toBe('Migration failed');
		await act(async () => Promise.resolve());
		expect(mocks.updateSelection).toHaveBeenCalledTimes(1);

		fireEvent.click(screen.getByRole('button', { name: 'Retry migration' }));
		await waitFor(() => expect(mocks.updateSelection).toHaveBeenCalledTimes(2));
	});

	it('uses the legacy selection while migration is failed', async () => {
		localStorage.setItem('nao.usage-filters.project-a', JSON.stringify({ periodMode: '6m' }));
		mocks.getSettings.mockResolvedValue({ selection: null, savedPeriods: [] });
		mocks.updateSelection.mockRejectedValue(new Error('Migration failed'));

		renderHarness(vi.fn());

		expect((await screen.findByRole('alert')).textContent).toBe('Migration failed');
		expect(screen.getByTestId('status').textContent).toBe('ready');
		expect(screen.getByTestId('selection').textContent).toBe('6m');
		expect(screen.getByTestId('period').textContent).toBe('6-month');
	});

	it('does not overwrite a newer server selection when retrying migration', async () => {
		localStorage.setItem('nao.usage-filters.project-a', JSON.stringify({ periodMode: '6m' }));
		mocks.getSettings.mockResolvedValue({ selection: null, savedPeriods: [] });
		mocks.updateSelection.mockRejectedValue(new Error('Migration failed'));
		renderHarness(vi.fn());
		await screen.findByRole('alert');

		mocks.getSettings.mockResolvedValue({ selection: { mode: '24h' }, savedPeriods: [] });
		fireEvent.click(screen.getByRole('button', { name: 'Retry migration' }));

		await waitFor(() => expect(readStoredUsagePeriodSelection('project-a')).toBeUndefined());
		expect(mocks.updateSelection).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole('button', { name: 'Retry migration' })).toBeNull();
	});

	it('reconciles failed migration state with a newer user selection', async () => {
		localStorage.setItem('nao.usage-filters.project-a', JSON.stringify({ periodMode: '6m' }));
		mocks.getSettings.mockResolvedValue({ selection: null, savedPeriods: [] });
		mocks.updateSelection
			.mockRejectedValueOnce(new Error('Migration failed'))
			.mockResolvedValueOnce({ mode: '24h' });
		renderHarness(vi.fn());
		await screen.findByRole('alert');

		fireEvent.click(screen.getByRole('button', { name: 'Select 24 hours' }));

		await waitFor(() => expect(readStoredUsagePeriodSelection('project-a')).toBeUndefined());
		expect(mocks.updateSelection.mock.calls.at(-1)?.[0]).toEqual({
			projectId: 'project-a',
			selection: { mode: '24h' },
		});
		expect(screen.queryByRole('button', { name: 'Retry migration' })).toBeNull();
	});

	it('retries a failed legacy migration after a page reload', async () => {
		localStorage.setItem('nao.usage-filters.project-a', JSON.stringify({ periodMode: '6m' }));
		mocks.getSettings.mockResolvedValue({ selection: null, savedPeriods: [] });
		mocks.updateSelection.mockRejectedValue(new Error('Migration failed'));
		const firstPage = renderHarness(vi.fn());

		saveUsageFilters(DEFAULT_USAGE_SEARCH);
		expect((await screen.findByRole('alert')).textContent).toBe('Migration failed');
		expect(readStoredUsagePeriodSelection('project-a')).toEqual({ mode: '6m' });

		firstPage.unmount();
		mocks.updateSelection.mockResolvedValue({ mode: '6m' });
		renderHarness(vi.fn());

		await waitFor(() => expect(mocks.updateSelection).toHaveBeenCalledTimes(2));
		expect(mocks.updateSelection.mock.calls[1]?.[0]).toEqual({
			projectId: 'project-a',
			selection: { mode: '6m' },
		});
		await waitFor(() => expect(readStoredUsagePeriodSelection('project-a')).toBeUndefined());
	});

	it('clears a stale saved period id after saved periods load', async () => {
		const onUpdateSearch = vi.fn();
		renderHarness(onUpdateSearch, { ...DEFAULT_USAGE_SEARCH, savedPeriodId: 'missing' });

		await waitFor(() => expect(onUpdateSearch).toHaveBeenCalledWith({ savedPeriodId: undefined }));
	});

	it('does not update the new project URL when an old create completes', async () => {
		let resolveCreate: (savedPeriod: { id: string; days: number; granularity: 'day' }) => void = () => undefined;
		mocks.createSavedPeriod.mockReturnValue(
			new Promise((resolve) => {
				resolveCreate = resolve;
			}),
		);
		const onUpdateSearch = vi.fn();
		const { queryClient, rerenderHarness } = renderHarness(onUpdateSearch);
		await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));

		fireEvent.click(screen.getByRole('button', { name: 'Create period' }));
		localStorage.setItem('nao.active-project-id', JSON.stringify('project-b'));
		rerenderHarness(1);
		await waitFor(() => expect(mocks.settingsQueryOptions).toHaveBeenLastCalledWith({ projectId: 'project-b' }));
		await act(async () => resolveCreate({ id: 'created', days: 30, granularity: 'day' }));

		expect(onUpdateSearch).not.toHaveBeenCalled();
		expect(getCachedSavedPeriods(queryClient, 'project-a')).toContainEqual({
			id: 'created',
			days: 30,
			granularity: 'day',
		});
		expect(getCachedSavedPeriods(queryClient, 'project-b')).not.toContainEqual(
			expect.objectContaining({ id: 'created' }),
		);
	});

	it('optimistically updates a saved period and rolls it back without changing the URL', async () => {
		let rejectUpdate: (cause: Error) => void = () => undefined;
		mocks.updateSavedPeriod.mockReturnValue(
			new Promise((_resolve, reject) => {
				rejectUpdate = reject;
			}),
		);
		const onUpdateSearch = vi.fn();
		renderHarness(onUpdateSearch);
		await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));

		fireEvent.click(screen.getByRole('button', { name: 'Update period' }));
		await waitFor(() =>
			expect(JSON.parse(screen.getByTestId('saved-periods').textContent ?? '[]')).toContainEqual({
				id: 'year',
				days: 730,
				granularity: 'month',
			}),
		);

		await act(async () => rejectUpdate(new Error('Update failed')));
		await waitFor(() =>
			expect(JSON.parse(screen.getByTestId('saved-periods').textContent ?? '[]')).toContainEqual({
				id: 'year',
				days: 365,
				granularity: 'month',
			}),
		);
		expect(onUpdateSearch).not.toHaveBeenCalled();
	});

	it('does not roll back the new project URL when an old selection fails', async () => {
		let rejectUpdate: (cause: Error) => void = () => undefined;
		mocks.updateSelection.mockReturnValue(
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
		let resolveDelete: (result: { id: string; selection: typeof DEFAULT_USAGE_PERIOD_SELECTION }) => void = () =>
			undefined;
		mocks.deleteSavedPeriod.mockReturnValue(
			new Promise((resolve) => {
				resolveDelete = resolve;
			}),
		);
		const onUpdateSearch = vi.fn();
		const { rerenderHarness } = renderHarness(onUpdateSearch, {
			...DEFAULT_USAGE_SEARCH,
			savedPeriodId: 'year',
		});
		await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));

		fireEvent.click(screen.getByRole('button', { name: 'Delete period' }));
		localStorage.setItem('nao.active-project-id', JSON.stringify('project-b'));
		rerenderHarness(1);
		await act(async () =>
			resolveDelete({
				id: 'year',
				selection: DEFAULT_USAGE_PERIOD_SELECTION,
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
		queryClient,
		rerenderHarness(revision: number) {
			result.rerender(
				<QueryClientProvider client={queryClient}>
					<Harness onUpdateSearch={onUpdateSearch} revision={revision} usageSearch={usageSearch} />
				</QueryClientProvider>,
			);
		},
	};
}

function getCachedSavedPeriods(queryClient: QueryClient, projectId: string) {
	return (
		queryClient.getQueryData<{
			savedPeriods: { id: string; days: number; granularity: string }[];
		}>([['usage', 'getPeriodSettings'], { input: { projectId } }])?.savedPeriods ?? []
	);
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
	const state = useUsagePeriodSettings({ canViewUsage: true, usageSearch, onUpdateSearch });

	return (
		<div data-revision={revision}>
			<div data-testid='status'>{state.isReady ? 'ready' : state.isLoading ? 'loading' : 'error'}</div>
			<div data-testid='selection'>{state.selection.mode}</div>
			<div data-testid='period'>{`${state.period.value}-${state.period.unit}`}</div>
			<div data-testid='saved-periods'>{JSON.stringify(state.savedPeriods)}</div>
			{state.error && <div role='alert'>{state.error}</div>}
			<button
				type='button'
				onClick={() => {
					void state.selectPeriod({ mode: 'saved', savedPeriodId: 'year' }).catch(() => undefined);
				}}
			>
				Select saved period
			</button>
			<button
				type='button'
				onClick={() => {
					void state.selectPeriod({ mode: '24h' }).catch(() => undefined);
				}}
			>
				Select 24 hours
			</button>
			<button
				type='button'
				onClick={() => {
					void state.createSavedPeriod({ days: 30, granularity: 'day' });
				}}
			>
				Create period
			</button>
			<button
				type='button'
				onClick={() => {
					void state
						.updateSavedPeriod({ id: 'year', days: 730, granularity: 'month' })
						.catch(() => undefined);
				}}
			>
				Update period
			</button>
			<button
				type='button'
				onClick={() => {
					void state.deleteSavedPeriod('year');
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
