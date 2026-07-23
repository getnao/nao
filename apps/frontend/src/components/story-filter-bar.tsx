import { AlertTriangle, FilterX, ListFilter, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StoryFilterSelection } from '@nao/shared/sql-template';
import type { ParsedFilterBlock } from '@nao/shared/story-segments';

import type { StoryFilterApi } from '@/hooks/use-story-filters';
import { FixInChatButton } from '@/components/fix-in-chat-button';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { trpc } from '@/main';

export function StoryFilterBar({
	filters,
	selections,
	onSelectionChange,
	onClear,
	api,
	isFiltering,
}: {
	filters: ParsedFilterBlock[];
	selections: Record<string, StoryFilterSelection>;
	onSelectionChange: (filterId: string, selection: StoryFilterSelection) => void;
	onClear: () => void;
	api?: StoryFilterApi | null;
	isFiltering?: boolean;
}) {
	const [optionErrors, setOptionErrors] = useState<Record<string, string>>({});

	useEffect(() => {
		const filterIds = new Set(filters.map((filter) => filter.id));
		setOptionErrors((current) => {
			const next = Object.fromEntries(Object.entries(current).filter(([id]) => filterIds.has(id)));
			return Object.keys(next).length === Object.keys(current).length ? current : next;
		});
	}, [filters]);

	const reportOptionError = useCallback((filterId: string, error: string | null) => {
		setOptionErrors((current) => {
			if (error) {
				if (current[filterId] === error) {
					return current;
				}
				return { ...current, [filterId]: error };
			}
			if (!(filterId in current)) {
				return current;
			}
			const next = { ...current };
			delete next[filterId];
			return next;
		});
	}, []);

	if (filters.length === 0) {
		return null;
	}

	const hasActiveFilters = Object.values(selections).some((selection) =>
		typeof selection === 'string' ? Boolean(selection) : selection.some(Boolean),
	);

	return (
		<div className='flex flex-col gap-2'>
			<div className='flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-3'>
				{filters.map((filter) => (
					<StoryFilterControl
						key={filter.id}
						filter={filter}
						selection={selections[filter.id]}
						onChange={(selection) => onSelectionChange(filter.id, selection)}
						onOptionError={reportOptionError}
						api={api}
					/>
				))}
				{hasActiveFilters && (
					<Button variant='ghost' size='sm' className='h-8 gap-1.5' onClick={onClear}>
						<FilterX className='size-3.5' />
						Clear
					</Button>
				)}
			</div>
			<FilterOptionsErrorBanner filters={filters} errors={optionErrors} />
		</div>
	);
}

function StoryFilterControl({
	filter,
	selection,
	onChange,
	onOptionError,
	api,
}: {
	filter: ParsedFilterBlock;
	selection: StoryFilterSelection | undefined;
	onChange: (selection: StoryFilterSelection) => void;
	onOptionError: (filterId: string, error: string | null) => void;
	api?: StoryFilterApi | null;
}) {
	const { options, error, isLoading } = useFilterOptions(filter, api);

	useEffect(() => {
		onOptionError(filter.id, error);
	}, [filter.id, error, onOptionError]);

	return (
		<label className='flex min-w-36 flex-col gap-1'>
			<span className='text-xs font-medium text-muted-foreground'>{filter.label}</span>
			{filter.filterType === 'select' ? (
				isLoading ? (
					<FilterOptionsLoading />
				) : (
					<Select
						value={typeof selection === 'string' && selection ? selection : '__all__'}
						onValueChange={(value) => onChange(value === '__all__' ? '' : value)}
					>
						<SelectTrigger className='h-8 min-w-36 bg-background'>
							<SelectValue placeholder='All' />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='__all__'>All</SelectItem>
							{options.map((option) => (
								<SelectItem key={option} value={option}>
									{option}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)
			) : filter.filterType === 'multi_select' ? (
				isLoading ? (
					<FilterOptionsLoading />
				) : (
					<MultiSelectFilter
						options={options}
						value={Array.isArray(selection) ? selection : []}
						onChange={onChange}
					/>
				)
			) : filter.filterType === 'date_range' ? (
				<RangeFilter value={Array.isArray(selection) ? selection : []} onChange={onChange} />
			) : (
				<Input
					type='search'
					className='h-8 min-w-44 bg-background'
					placeholder='Search'
					value={typeof selection === 'string' ? selection : ''}
					onChange={(event) => onChange(event.target.value)}
				/>
			)}
		</label>
	);
}

function FilterOptionsLoading() {
	return (
		<div className='flex h-8 min-w-36 items-center gap-2 rounded-md border bg-background px-3 text-xs text-muted-foreground'>
			<Loader2 className='size-3.5 animate-spin' />
			Loading…
		</div>
	);
}

function MultiSelectFilter({
	options,
	value,
	onChange,
}: {
	options: string[];
	value: string[];
	onChange: (value: string[]) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant='outline' size='sm' className='h-8 min-w-36 justify-between bg-background font-normal'>
					{value.length > 0 ? `${value.length} selected` : 'All'}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className='max-h-64 min-w-48'>
				{options.map((option) => (
					<DropdownMenuCheckboxItem
						key={option}
						checked={value.includes(option)}
						onSelect={(event) => event.preventDefault()}
						onCheckedChange={(checked) =>
							onChange(checked ? [...value, option] : value.filter((candidate) => candidate !== option))
						}
					>
						{option}
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function RangeFilter({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
	return (
		<div className='flex items-center gap-1'>
			<Input
				type='date'
				className='h-8 w-36 bg-background'
				value={value[0] ?? ''}
				onChange={(event) => onChange([event.target.value, value[1] ?? ''])}
				aria-label='From'
			/>
			<span className='text-xs text-muted-foreground'>to</span>
			<Input
				type='date'
				className='h-8 w-36 bg-background'
				value={value[1] ?? ''}
				onChange={(event) => onChange([value[0] ?? '', event.target.value])}
				aria-label='To'
			/>
		</div>
	);
}

function FilterOptionsErrorBanner({
	filters,
	errors,
}: {
	filters: ParsedFilterBlock[];
	errors: Record<string, string>;
}) {
	const errorItems = filters
		.map((filter) => {
			const message = errors[filter.id];
			return message ? { id: filter.id, label: filter.label, message } : null;
		})
		.filter((item): item is { id: string; label: string; message: string } => item !== null);

	if (errorItems.length === 0) {
		return null;
	}

	const fixMessage = [
		"I'm seeing errors loading story filter options:",
		...errorItems.map((error) => `- Filter "${error.label}" (id: ${error.id}): ${error.message}`),
		'',
		'Please fix the filter definition. For table+column select filters with multiple databases, set database_id on the <filter> tag. Use a valid table/column identifier for the warehouse dialect (backticks for BigQuery hyphens).',
	].join('\n');

	return (
		<div className='flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200'>
			<div className='min-w-0 flex-1'>
				<div className='flex items-center gap-1.5 font-medium'>
					<AlertTriangle className='size-3.5 shrink-0' />
					<span>Failed to load filter options</span>
				</div>
				<ul className='mt-1 flex flex-col gap-0.5'>
					{errorItems.map((error) => (
						<li key={error.id} className='truncate'>
							<span className='font-medium'>{error.label}:</span> {error.message}
						</li>
					))}
				</ul>
			</div>
			<FixInChatButton message={fixMessage} className='shrink-0 gap-1.5' />
		</div>
	);
}

function useFilterOptions(
	filter: ParsedFilterBlock,
	api?: StoryFilterApi | null,
): { options: string[]; error: string | null; isLoading: boolean } {
	const usesHardcodedOptions = Boolean(filter.options?.length);
	const needsRemoteOptions =
		!usesHardcodedOptions && (filter.filterType === 'select' || filter.filterType === 'multi_select');

	const ownedQuery = useQuery({
		...trpc.story.getFilterOptions.queryOptions({
			chatId: api?.kind === 'owned' ? api.chatId : '',
			storySlug: api?.kind === 'owned' ? api.storySlug : '',
			filterId: filter.id,
		}),
		enabled: Boolean(api?.kind === 'owned' && needsRemoteOptions),
	});

	const sharedQuery = useQuery({
		...trpc.storyShare.getFilterOptions.queryOptions({
			shareId: api?.kind === 'shared' ? api.shareId : '',
			filterId: filter.id,
		}),
		enabled: Boolean(api?.kind === 'shared' && needsRemoteOptions),
	});

	if (usesHardcodedOptions) {
		return { options: filter.options ?? [], error: null, isLoading: false };
	}

	const query = api?.kind === 'shared' ? sharedQuery : ownedQuery;
	return {
		options: query.data?.options ?? [],
		error: query.error?.message ?? null,
		isLoading: needsRemoteOptions && Boolean(api) && query.isPending,
	};
}
