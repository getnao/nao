import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { StoryFilterSelection } from '@nao/shared/sql-template';
import type { ParsedFilterBlock } from '@nao/shared/story-segments';

import type { StoryFilterApi } from '@/hooks/use-story-filters';
import { useStoryFilterOptions } from '@/hooks/use-story-filter-options';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export function StoryFilterOptionsSelect({
	filter,
	selection,
	parentSelection,
	onChange,
	onOptionError,
	api,
}: {
	filter: ParsedFilterBlock;
	selection: StoryFilterSelection | undefined;
	parentSelection?: StoryFilterSelection;
	onChange: (selection: StoryFilterSelection) => void;
	onOptionError: (filterId: string, error: string | null) => void;
	api?: StoryFilterApi | null;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [search, setSearch] = useState('');
	const isMulti = filter.filterType === 'multi_select';
	const selectedValues = toSelectedValues(selection);
	const optionsState = useStoryFilterOptions({ filter, api, search, parentSelection });

	useEffect(() => {
		onOptionError(filter.id, optionsState.error);
	}, [filter.id, optionsState.error, onOptionError]);

	useDropSelectionsOnParentChange({
		filter,
		parentSelection,
		selectedValues,
		completeOptions: optionsState.completeOptions,
		isLoading: optionsState.isLoading,
		onChange: (kept) => onChange(isMulti ? kept : ''),
	});

	const handleOpenChange = (open: boolean) => {
		setIsOpen(open);
		if (!open) {
			setSearch('');
		}
	};

	const selectValue = (value: string) => {
		if (isMulti) {
			onChange(
				selectedValues.includes(value)
					? selectedValues.filter((candidate) => candidate !== value)
					: [...selectedValues, value],
			);
			return;
		}
		onChange(value);
		handleOpenChange(false);
	};

	const visibleOptions = withSelectedValuesFirst(optionsState.options, selectedValues, search);
	const typedValue = search.trim();
	const canUseTypedValue =
		filter.allowCustom && typedValue !== '' && !visibleOptions.includes(typedValue) && !optionsState.isSearching;

	return (
		<Popover open={isOpen} onOpenChange={handleOpenChange}>
			<PopoverTrigger asChild>
				<Button
					variant='outline'
					size='sm'
					className='nao-filter__control h-8 min-w-36 max-w-56 justify-between bg-background font-normal'
				>
					<span className={cn('truncate', selectedValues.length === 0 && 'text-muted-foreground')}>
						{describeSelection(selectedValues)}
					</span>
					{optionsState.isLoading ? (
						<Loader2 className='size-3.5 animate-spin text-muted-foreground' />
					) : (
						<ChevronDown className='size-3.5 opacity-50' />
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent className='w-64 p-0' align='start'>
				<Command shouldFilter={false}>
					<CommandInput value={search} onValueChange={setSearch} placeholder={`Search ${filter.label}…`} />
					<CommandList className='max-h-64'>
						{!isMulti && !search && (
							<CommandItem value='__all__' onSelect={() => selectValue('')}>
								All
								<Check className={cn('ml-auto size-3.5', selectedValues.length > 0 && 'opacity-0')} />
							</CommandItem>
						)}
						{visibleOptions.map((option) => (
							<CommandItem key={option} value={option} onSelect={() => selectValue(option)}>
								<span className='truncate'>{option}</span>
								<Check
									className={cn('ml-auto size-3.5', !selectedValues.includes(option) && 'opacity-0')}
								/>
							</CommandItem>
						))}
						{canUseTypedValue && (
							<CommandItem value={`__custom__${typedValue}`} onSelect={() => selectValue(typedValue)}>
								Use “{typedValue}”
							</CommandItem>
						)}
						<CommandEmpty>
							{describeEmptyState(optionsState.isLoading, optionsState.isSearching)}
						</CommandEmpty>
					</CommandList>
					<OptionsFooter
						isComplete={optionsState.isComplete}
						isSearching={optionsState.isSearching}
						hasSearch={search.trim() !== ''}
					/>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

/**
 * Once the options for a new parent selection load, drops child values outside them, or all of them when the
 * list is truncated and cannot be checked. Runs only on parent changes, so values typed with allow_custom stay.
 */
function useDropSelectionsOnParentChange({
	filter,
	parentSelection,
	selectedValues,
	completeOptions,
	isLoading,
	onChange,
}: {
	filter: ParsedFilterBlock;
	parentSelection: StoryFilterSelection | undefined;
	selectedValues: string[];
	completeOptions: string[] | null;
	isLoading: boolean;
	onChange: (kept: string[]) => void;
}) {
	const parentKey = JSON.stringify(parentSelection ?? null);
	const handledParentKey = useRef(parentKey);

	useEffect(() => {
		if (!filter.dependsOn || isLoading || handledParentKey.current === parentKey) {
			return;
		}
		handledParentKey.current = parentKey;
		const allowed = new Set(completeOptions ?? []);
		const kept = selectedValues.filter((value) => allowed.has(value));
		if (kept.length !== selectedValues.length) {
			onChange(kept);
		}
	}, [filter.dependsOn, isLoading, parentKey, completeOptions, selectedValues, onChange]);
}

function OptionsFooter({
	isComplete,
	isSearching,
	hasSearch,
}: {
	isComplete: boolean;
	isSearching: boolean;
	hasSearch: boolean;
}) {
	if (isSearching) {
		return (
			<div className='flex items-center gap-1.5 border-t px-3 py-1.5 text-xs text-muted-foreground'>
				<Loader2 className='size-3 animate-spin' />
				Searching…
			</div>
		);
	}
	if (isComplete || hasSearch) {
		return null;
	}
	return (
		<div className='border-t px-3 py-1.5 text-xs text-muted-foreground'>
			Showing the first values. Type to search all of them.
		</div>
	);
}

function toSelectedValues(selection: StoryFilterSelection | undefined): string[] {
	if (Array.isArray(selection)) {
		return selection.filter((value) => value.trim() !== '');
	}
	return selection ? [selection] : [];
}

/** Keeps selected values visible even when they fall outside the loaded or searched list. */
function withSelectedValuesFirst(options: string[], selectedValues: string[], search: string): string[] {
	if (search.trim() !== '') {
		return options;
	}
	const missing = selectedValues.filter((value) => !options.includes(value));
	return [...missing, ...options];
}

function describeSelection(selectedValues: string[]): string {
	if (selectedValues.length === 0) {
		return 'All';
	}
	return selectedValues.length === 1 ? selectedValues[0] : `${selectedValues.length} selected`;
}

function describeEmptyState(isLoading: boolean, isSearching: boolean): string {
	if (isLoading) {
		return 'Loading values…';
	}
	return isSearching ? 'Searching…' : 'No matching values.';
}
