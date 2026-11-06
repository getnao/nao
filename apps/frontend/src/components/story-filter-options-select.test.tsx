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

	it('loads options for the parent selection and drops values outside it', async () => {
		mocks.fetchOptions.mockResolvedValue({ options: ['Laptops', 'Phones'], isComplete: true });
		const onChange = vi.fn();
		renderSelect({
			filter: {
				id: 'subcategory',
				label: 'Sub-category',
				filterType: 'multi_select',
				table: 'products',
				column: 'subcategory',
				dependsOn: 'category',
			},
			selection: ['Laptops', 'Yoga'],
			parentSelection: 'Electronics',
			onChange,
			api: OWNED_API,
		});

		await waitFor(() => expect(onChange).toHaveBeenCalledWith(['Laptops']));
		expect(mocks.fetchOptions).toHaveBeenCalledWith(
			expect.objectContaining({ filterId: 'subcategory', parentSelection: 'Electronics' }),
		);
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

function renderSelect({
	filter,
	selection,
	parentSelection,
	onChange,
	api = null,
}: {
	filter: ParsedFilterBlock;
	selection?: StoryFilterSelection;
	parentSelection?: StoryFilterSelection;
	onChange: (selection: StoryFilterSelection) => void;
	api?: typeof OWNED_API | null;
}) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<StoryFilterOptionsSelect
				filter={filter}
				selection={selection}
				parentSelection={parentSelection}
				onChange={onChange}
				onOptionError={vi.fn()}
				api={api}
			/>
		</QueryClientProvider>,
	);
}

function optionLabels(): string[] {
	return screen.getAllByRole('option').map((option) => option.textContent?.trim() ?? '');
}
