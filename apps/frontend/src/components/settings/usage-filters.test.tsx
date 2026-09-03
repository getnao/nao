// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_USAGE_PERIOD_PREFERENCE, MAX_USAGE_PERIOD_ENTRIES } from '@nao/backend/usage';

import { UsageFilters } from './usage-filters';
import { UsagePeriodFilter } from './usage-period-filter';
import type { UsagePeriodEntry } from '@nao/backend/usage';

const periodEntries: UsagePeriodEntry[] = [{ id: 'year', days: 365, granularity: 'month' }];

describe('UsageFilters', () => {
	afterEach(cleanup);

	it('shows a neutral label while a saved entry is loading', () => {
		render(
			<UsagePeriodFilter
				value={{ mode: 'saved', entryId: 'year' }}
				entries={[]}
				isLoading
				onChange={vi.fn()}
				onCreateEntry={vi.fn()}
				onUpdateEntry={vi.fn()}
				onDeleteEntry={vi.fn()}
			/>,
		);

		expect(screen.getByRole('button', { name: 'Loading…' }).hasAttribute('disabled')).toBe(true);
	});

	it('disables creation when the saved entry limit is reached', () => {
		const entries: UsagePeriodEntry[] = Array.from({ length: MAX_USAGE_PERIOD_ENTRIES }, (_, index) => ({
			id: `entry-${index}`,
			days: index + 1,
			granularity: 'day',
		}));
		render(
			<UsagePeriodFilter
				value={DEFAULT_USAGE_PERIOD_PREFERENCE}
				entries={entries}
				onChange={vi.fn()}
				onCreateEntry={vi.fn()}
				onUpdateEntry={vi.fn()}
				onDeleteEntry={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Last 15 days' }));

		const addEntry = screen.getByRole('button', { name: `Entry limit reached (${MAX_USAGE_PERIOD_ENTRIES})` });
		expect(addEntry.hasAttribute('disabled')).toBe(true);
		fireEvent.click(addEntry);
		expect(screen.queryByRole('dialog', { name: 'Create period filter' })).toBeNull();
	});

	it('opens an add-entry dialog without a maximum day limit', () => {
		const onCreatePeriodEntry = vi.fn();
		render(
			<UsageFilters
				provider='all'
				onProviderChange={vi.fn()}
				periodPreference={DEFAULT_USAGE_PERIOD_PREFERENCE}
				onPeriodPreferenceChange={vi.fn()}
				periodEntries={[]}
				onCreatePeriodEntry={onCreatePeriodEntry}
				onUpdatePeriodEntry={vi.fn()}
				onDeletePeriodEntry={vi.fn()}
				availableProviders={[]}
				chatFacets={undefined}
				selectedUserNames={undefined}
				onSelectedUserNamesChange={vi.fn()}
				selectedSources={undefined}
				onSelectedSourcesChange={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Last 15 days' }));
		fireEvent.click(screen.getByRole('button', { name: 'Create filter' }));

		const daysInput = screen.getByRole('spinbutton', { name: 'Days' });
		expect(daysInput.getAttribute('max')).toBeNull();
		fireEvent.change(daysInput, { target: { value: '2000' } });
		fireEvent.click(screen.getByRole('button', { name: 'Create' }));

		expect(onCreatePeriodEntry).toHaveBeenCalledWith({
			days: 2000,
			granularity: 'day',
		});
	});

	it('rejects combinations above the technical bucket limit', () => {
		render(
			<UsageFilters
				provider='all'
				onProviderChange={vi.fn()}
				periodPreference={DEFAULT_USAGE_PERIOD_PREFERENCE}
				onPeriodPreferenceChange={vi.fn()}
				periodEntries={[]}
				onCreatePeriodEntry={vi.fn()}
				onUpdatePeriodEntry={vi.fn()}
				onDeletePeriodEntry={vi.fn()}
				availableProviders={[]}
				chatFacets={undefined}
				selectedUserNames={undefined}
				onSelectedUserNamesChange={vi.fn()}
				selectedSources={undefined}
				onSelectedSourcesChange={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Last 15 days' }));
		fireEvent.click(screen.getByRole('button', { name: 'Create filter' }));
		fireEvent.change(screen.getByRole('spinbutton', { name: 'Days' }), { target: { value: '2001' } });

		expect(screen.getByText(/Use monthly grouping/)).toBeDefined();
		expect(screen.getByRole('button', { name: 'Create' }).hasAttribute('disabled')).toBe(true);
	});

	it('selects, edits, and deletes saved entries', async () => {
		const onPeriodPreferenceChange = vi.fn();
		const onUpdatePeriodEntry = vi.fn();
		const onDeletePeriodEntry = vi.fn();
		render(
			<UsageFilters
				provider='all'
				onProviderChange={vi.fn()}
				periodPreference={DEFAULT_USAGE_PERIOD_PREFERENCE}
				onPeriodPreferenceChange={onPeriodPreferenceChange}
				periodEntries={periodEntries}
				onCreatePeriodEntry={vi.fn()}
				onUpdatePeriodEntry={onUpdatePeriodEntry}
				onDeletePeriodEntry={onDeletePeriodEntry}
				availableProviders={[]}
				chatFacets={undefined}
				selectedUserNames={undefined}
				onSelectedUserNamesChange={vi.fn()}
				selectedSources={undefined}
				onSelectedSourcesChange={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Last 15 days' }));
		fireEvent.click(screen.getByRole('button', { name: 'Last 365 days - Monthly' }));
		expect(onPeriodPreferenceChange).toHaveBeenCalledWith({ mode: 'saved', entryId: 'year' });

		fireEvent.click(screen.getByRole('button', { name: 'Last 15 days' }));
		fireEvent.click(screen.getByRole('button', { name: 'Edit Last 365 days - Monthly' }));
		fireEvent.change(screen.getByRole('spinbutton', { name: 'Days' }), { target: { value: '730' } });
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(onUpdatePeriodEntry).toHaveBeenCalledWith({
			id: 'year',
			days: 730,
			granularity: 'month',
		});

		await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit usage period' })).toBeNull());
		fireEvent.click(screen.getByRole('button', { name: 'Last 15 days' }));
		fireEvent.click(screen.getByRole('button', { name: 'Delete Last 365 days - Monthly' }));
		fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
		expect(onDeletePeriodEntry).toHaveBeenCalledWith('year');
	});

	it('keeps the delete dialog open and reports failures', async () => {
		const onDeletePeriodEntry = vi.fn().mockRejectedValue(new Error('Delete failed'));
		render(
			<UsageFilters
				provider='all'
				onProviderChange={vi.fn()}
				periodPreference={DEFAULT_USAGE_PERIOD_PREFERENCE}
				onPeriodPreferenceChange={vi.fn()}
				periodEntries={periodEntries}
				onCreatePeriodEntry={vi.fn()}
				onUpdatePeriodEntry={vi.fn()}
				onDeletePeriodEntry={onDeletePeriodEntry}
				availableProviders={[]}
				chatFacets={undefined}
				selectedUserNames={undefined}
				onSelectedUserNamesChange={vi.fn()}
				selectedSources={undefined}
				onSelectedSourcesChange={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Last 15 days' }));
		fireEvent.click(screen.getByRole('button', { name: 'Delete Last 365 days - Monthly' }));
		fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

		expect(await screen.findByText('Delete failed')).toBeDefined();
		expect(screen.getByRole('dialog', { name: 'Remove filter?' })).toBeDefined();
		expect(onDeletePeriodEntry).toHaveBeenCalledTimes(1);
	});

	it('prevents closing the entry dialog while saving', async () => {
		let resolveSave: () => void = () => undefined;
		const onCreatePeriodEntry = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveSave = resolve;
				}),
		);
		render(
			<UsageFilters
				provider='all'
				onProviderChange={vi.fn()}
				periodPreference={DEFAULT_USAGE_PERIOD_PREFERENCE}
				onPeriodPreferenceChange={vi.fn()}
				periodEntries={[]}
				onCreatePeriodEntry={onCreatePeriodEntry}
				onUpdatePeriodEntry={vi.fn()}
				onDeletePeriodEntry={vi.fn()}
				availableProviders={[]}
				chatFacets={undefined}
				selectedUserNames={undefined}
				onSelectedUserNamesChange={vi.fn()}
				selectedSources={undefined}
				onSelectedSourcesChange={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Last 15 days' }));
		fireEvent.click(screen.getByRole('button', { name: 'Create filter' }));
		fireEvent.click(screen.getByRole('button', { name: 'Create' }));
		fireEvent.click(screen.getByRole('button', { name: 'Close' }));

		expect(screen.getByRole('dialog', { name: 'Create period filter' })).toBeDefined();
		await act(async () => resolveSave());
		await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Create period filter' })).toBeNull());
	});
});
