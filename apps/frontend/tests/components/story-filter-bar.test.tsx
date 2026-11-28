// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStoryParametersFromCode } from '@nao/shared/story-segments';
import { stubResizeObserver, stubScrollIntoView } from '../helpers/browser-stubs';
import { createTestQueryClient } from '../helpers/query-client';
import type { ParsedFilterBlock, ParsedParameterBlock } from '@nao/shared/story-segments';
import type { StoryFilterApi } from '@/hooks/use-story-filters';
import { StoryFilterBar } from '@/components/story-filter-bar';
import { StoryQuerySqlProvider, useStoryFilterHover } from '@/contexts/story-query-sql';

vi.mock('@/main', () => ({
	trpc: {
		story: {
			getFilterOptions: {
				queryOptions: (request: { filterId: string }) => ({
					queryKey: ['options', request],
					queryFn: () => Promise.reject(new Error(`Unknown column ${request.filterId}_tier`)),
				}),
			},
			getStandaloneFilterOptions: {
				queryOptions: () => ({ queryKey: ['standalone-options'], queryFn: vi.fn() }),
			},
		},
		storyShare: { getFilterOptions: { queryOptions: () => ({ queryKey: ['shared-options'], queryFn: vi.fn() }) } },
	},
}));

const notifyResize = stubResizeObserver();
stubScrollIntoView();

const OWNED_STORY_API: StoryFilterApi = { kind: 'owned', chatId: 'chat-1', storySlug: 'sales-story' };
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

describe('StoryFilterBar with more filters than fit on one row', () => {
	const ROW_FILTERS = ['Region', 'Country', 'Segment', 'Plan', 'Status'].map(selectFilter);

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it('folds the filters that do not fit behind a "+N filters" menu', () => {
		stubFilterRowLayout({ rowWidth: 500, slotWidth: 150, buttonWidth: 80 });
		renderBar({ selections: {}, filters: ROW_FILTERS, parameters: [] });

		expect(screen.getByText('Country')).toBeTruthy();
		expect(screen.queryByText('Segment')).toBeNull();

		fireEvent.click(screen.getByRole('button', { name: '+3 filters' }));

		const menuLabels = within(screen.getByRole('dialog')).getAllByText(/^(Region|Country|Segment|Plan|Status)$/);
		expect(menuLabels.map((label) => label.textContent)).toEqual(['Segment', 'Plan', 'Status']);
	});

	it('keeps a filter with a value on the row', () => {
		stubFilterRowLayout({ rowWidth: 500, slotWidth: 150, buttonWidth: 80 });
		renderBar({ selections: { status: 'Status 1' }, filters: ROW_FILTERS, parameters: [] });

		expect(screen.getByText('Status')).toBeTruthy();
		expect(screen.queryByText('Country')).toBeNull();
		expect(screen.getByRole('button', { name: '+3 filters' })).toBeTruthy();
	});

	it('leaves a filter given a value in the menu there until the menu closes', async () => {
		stubFilterRowLayout({ rowWidth: 500, slotWidth: 150, buttonWidth: 80 });
		const { rerender } = renderBar({ selections: {}, filters: ROW_FILTERS, parameters: [] });
		fireEvent.click(screen.getByRole('button', { name: '+3 filters' }));

		rerender(barElement({ selections: { segment: 'Segment 1' }, filters: ROW_FILTERS, parameters: [] }));
		expect(within(screen.getByRole('dialog')).getByText('Segment')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: '+3 filters' }));
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(await screen.findByText('Segment')).toBeTruthy();
	});

	it('keeps folding the filters after an open picker on the row', () => {
		stubFilterRowLayout({ rowWidth: 450, slotWidth: 150, buttonWidth: 80 });
		const { rerender } = renderBar({ selections: {}, filters: ROW_FILTERS, parameters: [] });
		fireEvent.click(within(filterSlot('Region')).getByRole('button'));

		rerender(barElement({ selections: { region: 'Region 1' }, filters: ROW_FILTERS, parameters: [] }));

		expect(screen.queryByText('Country')).toBeNull();
		expect(screen.getByText('Region')).toBeTruthy();
	});

	it('waits until an open picker closes to fold a filter before it', async () => {
		stubFilterRowLayout({ rowWidth: 450, slotWidth: 150, buttonWidth: 80 });
		const { rerender } = renderBar({ selections: {}, filters: ROW_FILTERS, parameters: [] });
		const countryPicker = within(filterSlot('Country')).getByRole('button');
		fireEvent.click(countryPicker);

		rerender(barElement({ selections: { country: 'Country 1' }, filters: ROW_FILTERS, parameters: [] }));
		expect(screen.getByText('Region')).toBeTruthy();

		fireEvent.click(countryPicker);
		await waitFor(() => expect(screen.queryByText('Region')).toBeNull());
	});

	it('lets a click on the row land before the closing menu reshuffles it', async () => {
		stubFilterRowLayout({ rowWidth: 500, slotWidth: 150, buttonWidth: 80 });
		const { rerender } = renderBar({ selections: {}, filters: ROW_FILTERS, parameters: [] });
		fireEvent.click(screen.getByRole('button', { name: '+3 filters' }));
		await waitForRadixOutsidePressListener();
		rerender(barElement({ selections: { status: 'Status 1' }, filters: ROW_FILTERS, parameters: [] }));
		const countryPicker = within(filterSlot('Country')).getByRole('button');

		fireEvent.pointerDown(countryPicker);
		await act(async () => {});
		fireEvent.pointerUp(countryPicker);
		fireEvent.click(countryPicker);

		await waitFor(() => expect(countryPicker.getAttribute('aria-expanded')).toBe('true'));
		expect(filterSlot('Country')).toBeTruthy();
	});

	it('folds without waiting when the press that closes the menu is outside the bar', async () => {
		stubFilterRowLayout({ rowWidth: 500, slotWidth: 150, buttonWidth: 80 });
		const { rerender } = renderBar({ selections: {}, filters: ROW_FILTERS, parameters: [] });
		fireEvent.click(screen.getByRole('button', { name: '+3 filters' }));
		await waitForRadixOutsidePressListener();
		rerender(barElement({ selections: { status: 'Status 1' }, filters: ROW_FILTERS, parameters: [] }));

		fireEvent.pointerDown(document.body);
		await act(async () => {});

		expect(screen.queryByText('Country')).toBeNull();
		expect(screen.getByText('Status')).toBeTruthy();
	});

	it('folds more filters when the row gets narrower', () => {
		stubFilterRowLayout({ rowWidth: 1000, slotWidth: 150, buttonWidth: 80 });
		renderBar({ selections: {}, filters: ROW_FILTERS, parameters: [] });
		expect(screen.getByText('Status')).toBeTruthy();

		stubFilterRowLayout({ rowWidth: 500, slotWidth: 150, buttonWidth: 80 });
		act(() => {
			notifyResize();
		});

		expect(screen.queryByText('Status')).toBeNull();
		expect(screen.getByRole('button', { name: '+3 filters' })).toBeTruthy();
	});

	it('reports option errors of a folded filter without opening the menu', async () => {
		stubFilterRowLayout({ rowWidth: 500, slotWidth: 150, buttonWidth: 80 });
		const filters = ROW_FILTERS.map((filter) => (filter.id === 'plan' ? remoteFilter('Plan') : filter));
		renderBar({ selections: {}, filters, parameters: [], api: OWNED_STORY_API });

		expect(await screen.findByText('Failed to load filter options')).toBeTruthy();
		expect(screen.getByText('Unknown column plan_tier')).toBeTruthy();
	});

	it('stops highlighting charts when the menu closes under the pointer', () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		stubFilterRowLayout({ rowWidth: 500, slotWidth: 150, buttonWidth: 80 });
		render(
			<StoryQuerySqlProvider value={null}>
				<HoveredFilterProbe />
				{barElement({ selections: {}, filters: ROW_FILTERS, parameters: [] })}
			</StoryQuerySqlProvider>,
		);
		fireEvent.click(screen.getByRole('button', { name: '+3 filters' }));

		fireEvent.pointerEnter(within(screen.getByRole('dialog')).getByText('Plan'));
		act(() => {
			vi.advanceTimersByTime(250);
		});
		expect(screen.getByTestId('hovered-filter').textContent).toBe('plan');

		fireEvent.click(screen.getByRole('button', { name: '+3 filters' }));
		expect(screen.getByTestId('hovered-filter').textContent).toBe('');
	});
});

function HoveredFilterProbe() {
	return <output data-testid='hovered-filter'>{useStoryFilterHover()?.hoveredFilterId ?? ''}</output>;
}

function selectFilter(label: string): ParsedFilterBlock {
	return { id: label.toLowerCase(), label, filterType: 'select', options: [`${label} 1`, `${label} 2`] };
}

function remoteFilter(label: string): ParsedFilterBlock {
	const id = label.toLowerCase();
	return { id, label, filterType: 'select', table: 'dim_accounts', column: `${id}_tier` };
}

function filterSlot(label: string): HTMLElement {
	return screen.getByText(label).closest('[data-filter-slot]') as HTMLElement;
}

/** Radix starts listening for presses outside an open popover one tick after it opens. */
async function waitForRadixOutsidePressListener() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

/** jsdom has no layout, so the row, its filter slots and the measured buttons get fixed widths. */
function stubFilterRowLayout({
	rowWidth,
	slotWidth,
	buttonWidth,
}: {
	rowWidth: number;
	slotWidth: number;
	buttonWidth: number;
}) {
	vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
		const width = this.hasAttribute('data-filter-row')
			? rowWidth
			: this.hasAttribute('data-filter-slot')
				? slotWidth
				: this.hasAttribute('data-filter-measure')
					? buttonWidth
					: 0;
		return { width, height: 32, top: 0, left: 0, right: width, bottom: 32, x: 0, y: 0, toJSON: () => ({}) };
	});
}

function renderBar(props: Partial<Parameters<typeof barElement>[0]> & { selections: Record<string, string> }) {
	return render(barElement({ onSelectionChange: vi.fn(), ...props }));
}

function barElement({
	selections,
	onSelectionChange = vi.fn(),
	skippedFilters = [],
	filters = [CHANNEL_FILTER],
	parameters = PARAMETERS,
	api,
}: {
	selections: Record<string, string>;
	onSelectionChange?: (id: string, value: unknown) => void;
	skippedFilters?: { id: string; label: string }[];
	filters?: ParsedFilterBlock[];
	parameters?: ParsedParameterBlock[];
	api?: StoryFilterApi;
}) {
	return (
		<QueryClientProvider client={createTestQueryClient()}>
			<StoryFilterBar
				filters={filters}
				parameters={parameters}
				skippedFilters={skippedFilters}
				selections={selections}
				onSelectionChange={onSelectionChange}
				onClear={vi.fn()}
				api={api}
			/>
		</QueryClientProvider>
	);
}
