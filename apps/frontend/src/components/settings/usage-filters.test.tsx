// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_USAGE_PERIOD_PREFERENCE } from '@nao/backend/usage';

import { UsageFilters } from './usage-filters';

describe('UsageFilters', () => {
	afterEach(cleanup);

	it('keeps the period popover open when switching to the custom form', () => {
		render(
			<UsageFilters
				provider='all'
				onProviderChange={vi.fn()}
				periodPreference={DEFAULT_USAGE_PERIOD_PREFERENCE}
				onPeriodPreferenceChange={vi.fn()}
				availableProviders={[]}
				chatFacets={undefined}
				selectedUserNames={undefined}
				onSelectedUserNamesChange={vi.fn()}
				selectedSources={undefined}
				onSelectedSourcesChange={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Last 15 days' }));
		fireEvent.click(screen.getByRole('button', { name: 'Custom…' }));

		expect(screen.getByText('Custom period')).toBeDefined();
		expect(screen.getByRole('spinbutton', { name: 'Period value' }).getAttribute('max')).toBe('30');
		expect(screen.getByText('Enter 1–30 days')).toBeDefined();
	});
});
