// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoryFilterOptionsSelect } from './story-filter-options-select';
import type { StoryFilterSelection } from '@nao/shared/sql-template';
import type { ParsedFilterBlock } from '@nao/shared/story-segments';

const mocks = vi.hoisted(() => ({
	fetchOptions: vi.fn(),
}));

vi.mock('@/main', () => ({
	trpc: {
		story: {
			getFilterOptions: {
				queryOptions: (input: Record<string, unknown>) => ({
					queryKey: ['story-filter-options', input],
					queryFn: () => mocks.fetchOptions(input),
				}),
			},
		},
		storyShare: {
			getFilterOptions: {
				queryOptions: (input: Record<string, unknown>) => ({
					queryKey: ['shared-story-filter-options', input],
					queryFn: () => mocks.fetchOptions(input),
				}),
			},
		},
	},
}));

vi.stubGlobal(
	'ResizeObserver',
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
);
Element.prototype.scrollIntoView = vi.fn();

const OWNED_API = { kind: 'owned', chatId: 'chat-1', storySlug: 'story' } as const;
const SUBCATEGORY_FILTER: ParsedFilterBlock = {
	id: 'subcategory',
	label: 'Sub-category',
	filterType: 'multi_select',
	table: 'products',
	column: 'subcategory',
	dependsOn: 'category',
};

beforeEach(() => {
	mocks.fetchOptions.mockReset();
});

afterEach(() => {
	cleanup();
});

describe('StoryFilterOptionsSelect', () => {
	it('filters a complete option list in the browser and toggles multi-select values', () => {
		const onChange = vi.fn();
		renderSelect({
			filter: {
				id: 'country',
				label: 'Country',
				filterType: 'multi_select',
				options: ['France', 'Spain', 'Peru'],
			},
			selection: ['Peru'],
			onChange,
		});

		fireEvent.click(screen.getByRole('button', { name: /Peru/ }));
		fireEvent.change(screen.getByPlaceholderText('Search Country…'), { target: { value: 'an' } });

		expect(optionLabels()).toEqual(['France']);
		fireEvent.click(screen.getByRole('option', { name: 'France' }));
		expect(onChange).toHaveBeenCalledWith(['Peru', 'France']);
	});

	it('offers the typed value when the filter allows custom values', () => {
		const onChange = vi.fn();
		renderSelect({
			filter: { id: 'sku', label: 'SKU', filterType: 'select', options: ['A-1'], allowCustom: true },
			onChange,
		});

		fireEvent.click(screen.getByRole('button', { name: /All/ }));
		fireEvent.change(screen.getByPlaceholderText('Search SKU…'), { target: { value: 'B-42' } });
		fireEvent.click(screen.getByRole('option', { name: 'Use “B-42”' }));

		expect(onChange).toHaveBeenCalledWith('B-42');
	});

	it('drops child values outside the new parent once its options load', async () => {
		mocks.fetchOptions.mockImplementation(async (input: { parentSelection?: string }) =>
			input.parentSelection === 'Electronics'
				? { options: ['Laptops', 'Phones'], isComplete: true }
				: { options: ['Laptops', 'Yoga'], isComplete: true },
		);
		const onChange = vi.fn();
		const props = {
			filter: SUBCATEGORY_FILTER,
			selection: ['Laptops', 'Yoga'],
			parentSelection: 'Mixed',
			onChange,
			api: OWNED_API,
		};
		const view = renderSelect(props);
		await waitFor(() => expect(mocks.fetchOptions).toHaveBeenCalledTimes(1));
		expect(onChange).not.toHaveBeenCalled();

		view.rerenderWith({ ...props, parentSelection: 'Electronics' });

		await waitFor(() => expect(onChange).toHaveBeenCalledWith(['Laptops']));
		expect(mocks.fetchOptions).toHaveBeenCalledWith(
			expect.objectContaining({ filterId: 'subcategory', parentSelection: 'Electronics' }),
		);
	});

	it('clears child values when the new parent list is truncated', async () => {
		mocks.fetchOptions.mockResolvedValue({ options: ['Laptops'], isComplete: false });
		const onChange = vi.fn();
		const props = {
			filter: SUBCATEGORY_FILTER,
			selection: ['Laptops'],
			parentSelection: 'Sports',
			onChange,
			api: OWNED_API,
		};
		const view = renderSelect(props);

		view.rerenderWith({ ...props, parentSelection: 'Electronics' });

		await waitFor(() => expect(onChange).toHaveBeenCalledWith([]));
	});

	it('keeps a typed child value while the parent stays the same', async () => {
		mocks.fetchOptions.mockResolvedValue({ options: ['Laptops'], isComplete: true });
		const onChange = vi.fn();
		const props = {
			filter: { ...SUBCATEGORY_FILTER, allowCustom: true },
			selection: ['Laptops'],
			parentSelection: 'Electronics',
			onChange,
			api: OWNED_API,
		};
		const view = renderSelect(props);
		await waitFor(() => expect(mocks.fetchOptions).toHaveBeenCalled());

		view.rerenderWith({ ...props, selection: ['Laptops', 'Typed SKU'] });
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(onChange).not.toHaveBeenCalled();
	});

	it('searches on the server when the loaded list was truncated', async () => {
		mocks.fetchOptions.mockImplementation(async (input: { search?: string }) =>
			input.search ? { options: ['user-99999'], isComplete: true } : { options: ['user-1'], isComplete: false },
		);
		renderSelect({
			filter: { id: 'user', label: 'User', filterType: 'select', table: 'users', column: 'name' },
			onChange: vi.fn(),
			api: OWNED_API,
		});

		fireEvent.click(screen.getByRole('button', { name: /All/ }));
		await screen.findByText('Showing the first values. Type to search all of them.');
		fireEvent.change(screen.getByPlaceholderText('Search User…'), { target: { value: '99999' } });

		expect(await screen.findByRole('option', { name: 'user-99999' })).toBeTruthy();
		expect(mocks.fetchOptions).toHaveBeenCalledWith(expect.objectContaining({ search: '99999' }));
	});
});

type SelectProps = {
	filter: ParsedFilterBlock;
	selection?: StoryFilterSelection;
	parentSelection?: StoryFilterSelection;
	onChange: (selection: StoryFilterSelection) => void;
	api?: typeof OWNED_API | null;
};

function renderSelect(props: SelectProps) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const view = render(selectElement(queryClient, props));
	return { ...view, rerenderWith: (next: SelectProps) => view.rerender(selectElement(queryClient, next)) };
}

function selectElement(
	queryClient: QueryClient,
	{ filter, selection, parentSelection, onChange, api = null }: SelectProps,
) {
	return (
		<QueryClientProvider client={queryClient}>
			<StoryFilterOptionsSelect
				filter={filter}
				selection={selection}
				parentSelection={parentSelection}
				onChange={onChange}
				onOptionError={vi.fn()}
				api={api}
			/>
		</QueryClientProvider>
	);
}

function optionLabels(): string[] {
	return screen.getAllByRole('option').map((option) => option.textContent?.trim() ?? '');
}
