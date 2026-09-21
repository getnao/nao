// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_USAGE_PERIOD_SELECTION, MAX_SAVED_USAGE_PERIODS } from '@nao/backend/usage';

import { UsageFilters } from './usage-filters';
import { UsagePeriodFilter } from './usage-period-filter';
import type { SavedUsagePeriod } from '@nao/backend/usage';

const savedPeriods: SavedUsagePeriod[] = [{ id: 'year', days: 365, granularity: 'month' }];

describe('UsageFilters', () => {
	afterEach(cleanup);

	it('shows a neutral label while a saved period is loading', () => {
		render(
			<UsagePeriodFilter
				value={{ mode: 'saved', savedPeriodId: 'year' }}
				savedPeriods={[]}
				isLoading
				onChange={vi.fn()}
				onCreateSavedPeriod={vi.fn()}
				onUpdateSavedPeriod={vi.fn()}
				onDeleteSavedPeriod={vi.fn()}
			/>,
		);

		expect(screen.getByRole('button', { name: 'Loading…' }).hasAttribute('disabled')).toBe(true);
	});

	it('disables creation when the saved period limit is reached', () => {
		const savedPeriodsAtLimit: SavedUsagePeriod[] = Array.from({ length: MAX_SAVED_USAGE_PERIODS }, (_, index) => ({
			id: `saved-period-${index}`,
			days: index + 1,
			granularity: 'day',
		}));
		render(
			<UsagePeriodFilter
				value={DEFAULT_USAGE_PERIOD_SELECTION}
				savedPeriods={savedPeriodsAtLimit}
				onChange={vi.fn()}
				onCreateSavedPeriod={vi.fn()}
				onUpdateSavedPeriod={vi.fn()}
				onDeleteSavedPeriod={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Last 15 days' }));

		const addSavedPeriod = screen.getByRole('button', {
			name: `Saved period limit reached (${MAX_SAVED_USAGE_PERIODS})`,
		});
		expect(addSavedPeriod.hasAttribute('disabled')).toBe(true);
		fireEvent.click(addSavedPeriod);
		expect(screen.queryByRole('dialog', { name: 'Create period filter' })).toBeNull();
	});

	it('opens an add-period dialog without a maximum day limit', () => {
		const onCreateSavedPeriod = vi.fn();
		render(
			<UsageFilters
				provider='all'
				onProviderChange={vi.fn()}
				periodSelection={DEFAULT_USAGE_PERIOD_SELECTION}
				onPeriodSelectionChange={vi.fn()}
				savedPeriods={[]}
				onCreateSavedPeriod={onCreateSavedPeriod}
				onUpdateSavedPeriod={vi.fn()}
				onDeleteSavedPeriod={vi.fn()}
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

		expect(onCreateSavedPeriod).toHaveBeenCalledWith({
			days: 2000,
			granularity: 'day',
		});
	});

	it('rejects combinations above the technical bucket limit', () => {
		render(
			<UsageFilters
				provider='all'
				onProviderChange={vi.fn()}
				periodSelection={DEFAULT_USAGE_PERIOD_SELECTION}
				onPeriodSelectionChange={vi.fn()}
				savedPeriods={[]}
				onCreateSavedPeriod={vi.fn()}
				onUpdateSavedPeriod={vi.fn()}
				onDeleteSavedPeriod={vi.fn()}
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
		fireEvent.change(daysInput, { target: { value: '2001' } });

		expect(screen.getByText(/Use monthly grouping/)).toBeDefined();
		expect(screen.getByRole('button', { name: 'Create' }).hasAttribute('disabled')).toBe(true);

		fireEvent.change(daysInput, { target: { value: '' } });
		const validationMessage = screen.getByText('Enter a positive whole number of days.');
		expect(daysInput.getAttribute('aria-invalid')).toBe('true');
		expect(daysInput.getAttribute('aria-describedby')).toBe(validationMessage.id);
	});

	it('selects, edits, and deletes saved periods', async () => {
		const onPeriodSelectionChange = vi.fn();
		const onUpdateSavedPeriod = vi.fn();
		const onDeleteSavedPeriod = vi.fn();
		render(
			<UsageFilters
				provider='all'
				onProviderChange={vi.fn()}
				periodSelection={DEFAULT_USAGE_PERIOD_SELECTION}
				onPeriodSelectionChange={onPeriodSelectionChange}
				savedPeriods={savedPeriods}
				onCreateSavedPeriod={vi.fn()}
				onUpdateSavedPeriod={onUpdateSavedPeriod}
				onDeleteSavedPeriod={onDeleteSavedPeriod}
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
		expect(onPeriodSelectionChange).toHaveBeenCalledWith({ mode: 'saved', savedPeriodId: 'year' });

		fireEvent.click(screen.getByRole('button', { name: 'Last 15 days' }));
		fireEvent.click(screen.getByRole('button', { name: 'Edit Last 365 days - Monthly' }));
		fireEvent.change(screen.getByRole('spinbutton', { name: 'Days' }), { target: { value: '730' } });
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(onUpdateSavedPeriod).toHaveBeenCalledWith({
			id: 'year',
			days: 730,
			granularity: 'month',
		});

		await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit period filter' })).toBeNull());
		fireEvent.click(screen.getByRole('button', { name: 'Last 15 days' }));
		fireEvent.click(screen.getByRole('button', { name: 'Delete Last 365 days - Monthly' }));
		fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
		expect(onDeleteSavedPeriod).toHaveBeenCalledWith('year');
	});

	it('keeps the delete dialog open and reports failures', async () => {
		const onDeleteSavedPeriod = vi.fn().mockRejectedValue(new Error('Delete failed'));
		render(
			<UsageFilters
				provider='all'
				onProviderChange={vi.fn()}
				periodSelection={DEFAULT_USAGE_PERIOD_SELECTION}
				onPeriodSelectionChange={vi.fn()}
				savedPeriods={savedPeriods}
				onCreateSavedPeriod={vi.fn()}
				onUpdateSavedPeriod={vi.fn()}
				onDeleteSavedPeriod={onDeleteSavedPeriod}
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
		expect(onDeleteSavedPeriod).toHaveBeenCalledTimes(1);
	});

	it('prevents closing the saved period dialog while saving', async () => {
		let resolveSave: () => void = () => undefined;
		const onCreateSavedPeriod = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveSave = resolve;
				}),
		);
		render(
			<UsageFilters
				provider='all'
				onProviderChange={vi.fn()}
				periodSelection={DEFAULT_USAGE_PERIOD_SELECTION}
				onPeriodSelectionChange={vi.fn()}
				savedPeriods={[]}
				onCreateSavedPeriod={onCreateSavedPeriod}
				onUpdateSavedPeriod={vi.fn()}
				onDeleteSavedPeriod={vi.fn()}
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
