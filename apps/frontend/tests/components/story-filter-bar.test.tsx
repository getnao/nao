// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStoryParametersFromCode } from '@nao/shared/story-segments';
import { stubResizeObserver } from '../helpers/browser-stubs';
import type { ParsedFilterBlock } from '@nao/shared/story-segments';
import { StoryFilterBar } from '@/components/story-filter-bar';

vi.mock('@/main', () => ({
	trpc: {
		story: { getFilterOptions: { queryOptions: () => ({ queryKey: ['options'], queryFn: vi.fn() }) } },
		storyShare: { getFilterOptions: { queryOptions: () => ({ queryKey: ['shared-options'], queryFn: vi.fn() }) } },
	},
}));

stubResizeObserver();

const PARAMETERS = getStoryParametersFromCode(
	`<parameter id="metric" label="Metric" type="metric" options='[{"value":"revenue","label":"Revenue"},{"value":"unique_sales","label":"Unique sales"}]' default="revenue" />`,
);
const CHANNEL_FILTER: ParsedFilterBlock = {
	id: 'channel',
	label: 'Channel',
	filterType: 'select',
	options: ['Online', 'Retail'],
	dimension: 'order__channel',
};

afterEach(() => {
	cleanup();
});

describe('StoryFilterBar with semantic parameters', () => {
	it('switches a parameter and only offers Clear once it differs from its default', () => {
		const onSelectionChange = vi.fn();
		const { rerender } = renderBar({ selections: {}, onSelectionChange });

		expect(screen.getByRole('radio', { name: 'Revenue' }).getAttribute('aria-checked')).toBe('true');
		expect(screen.queryByRole('button', { name: /Clear$/ })).toBeNull();

		fireEvent.click(screen.getByRole('radio', { name: 'Unique sales' }));
		expect(onSelectionChange).toHaveBeenCalledWith('metric', 'unique_sales');

		rerender(barElement({ selections: { metric: 'unique_sales' }, onSelectionChange }));
		expect(screen.getByRole('radio', { name: 'Unique sales' }).getAttribute('aria-checked')).toBe('true');
		expect(screen.getByRole('button', { name: /Clear$/ })).toBeTruthy();
	});

	it('says which filters a chart could not apply', () => {
		renderBar({
			selections: { channel: 'Online' },
			skippedFilters: [{ id: 'channel', label: 'Channel' }],
		});

		expect(screen.getByText(/is not applied to every chart/).textContent).toContain(
			"Channel is not applied to every chart: some metrics can't be filtered by this field.",
		);
	});
});

function renderBar(props: Partial<Parameters<typeof barElement>[0]> & { selections: Record<string, string> }) {
	return render(barElement({ onSelectionChange: vi.fn(), ...props }));
}

function barElement({
	selections,
	onSelectionChange,
	skippedFilters = [],
}: {
	selections: Record<string, string>;
	onSelectionChange: (id: string, value: unknown) => void;
	skippedFilters?: { id: string; label: string }[];
}) {
	return (
		<QueryClientProvider client={new QueryClient()}>
			<StoryFilterBar
				filters={[CHANNEL_FILTER]}
				parameters={PARAMETERS}
				skippedFilters={skippedFilters}
				selections={selections}
				onSelectionChange={onSelectionChange}
				onClear={vi.fn()}
			/>
		</QueryClientProvider>
	);
}
