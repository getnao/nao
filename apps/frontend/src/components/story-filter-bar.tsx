import { AlertTriangle, FilterX, Info, X } from 'lucide-react';
import { format } from 'date-fns';
import { useCallback, useEffect, useState } from 'react';
import { isFilterSelectionActive, isValidFilterTextValue } from '@nao/shared/sql-template';
import type { StoryFilterSelection } from '@nao/shared/sql-template';
import type { DateRange } from 'react-day-picker';
import type { ParsedFilterBlock, ParsedParameterBlock } from '@nao/shared/story-segments';

import type { SkippedStoryFilter, StoryFilterApi } from '@/hooks/use-story-filters';
import { DateRangePicker } from '@/components/date-range-picker';
import { FixInChatButton } from '@/components/fix-in-chat-button';
import { StoryFilterOptionsSelect } from '@/components/story-filter-options-select';
import { StoryParameterControl } from '@/components/story-parameter-control';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

const PARENT_SELECTION_DEBOUNCE_MS = 300;

export function StoryFilterBar({
	filters,
	parameters = [],
	skippedFilters = [],
	selections,
	onSelectionChange,
	onClear,
	api,
}: {
	filters: ParsedFilterBlock[];
	parameters?: ParsedParameterBlock[];
	skippedFilters?: SkippedStoryFilter[];
	selections: Record<string, StoryFilterSelection>;
	onSelectionChange: (filterId: string, selection: StoryFilterSelection) => void;
	onClear: () => void;
	api?: StoryFilterApi | null;
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

	if (filters.length === 0 && parameters.length === 0) {
		return null;
	}

	const hasActiveFilters = hasActiveSelections(filters, parameters, selections);

	return (
		<div className='flex flex-col gap-2'>
			<div className='nao-filter-bar flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-3'>
				{parameters.map((parameter) => (
					<StoryParameterControl
						key={parameter.id}
						parameter={parameter}
						value={
							typeof selections[parameter.id] === 'string'
								? (selections[parameter.id] as string)
								: undefined
						}
						onChange={(value) => onSelectionChange(parameter.id, value)}
					/>
				))}
				{filters.map((filter) => (
					<StoryFilterControl
						key={filter.id}
						filter={filter}
						selection={selections[filter.id]}
						parentSelection={getActiveParentSelection(filter, filters, selections)}
						onChange={(selection) => onSelectionChange(filter.id, selection)}
						onOptionError={reportOptionError}
						api={api}
					/>
				))}
				{hasActiveFilters && (
					<Button variant='ghost' size='sm' className='nao-filter__clear h-8 gap-1.5' onClick={onClear}>
						<FilterX className='size-3.5' />
						Clear
					</Button>
				)}
			</div>
			<SkippedFiltersNotice skippedFilters={skippedFilters} />
			<FilterOptionsErrorBanner filters={filters} errors={optionErrors} />
		</div>
	);
}

function SkippedFiltersNotice({ skippedFilters }: { skippedFilters: SkippedStoryFilter[] }) {
	if (skippedFilters.length === 0) {
		return null;
	}
	return (
		<ul className='flex flex-col gap-0.5 px-1 text-xs text-muted-foreground'>
			{skippedFilters.map((filter) => (
				<li key={filter.id} className='flex items-center gap-1.5'>
					<Info className='size-3.5 shrink-0' />
					<span>
						<span className='font-medium'>{filter.label}</span> is not applied to {filter.chartCount}{' '}
						{filter.chartCount === 1 ? 'chart' : 'charts'}: its metric can't be filtered by this field.
					</span>
				</li>
			))}
		</ul>
	);
}

function hasActiveSelections(
	filters: ParsedFilterBlock[],
	parameters: ParsedParameterBlock[],
	selections: Record<string, StoryFilterSelection>,
): boolean {
	const hasFilterSelection = filters.some((filter) => {
		const selection = selections[filter.id];
		return typeof selection === 'string' ? Boolean(selection) : Boolean(selection?.some(Boolean));
	});
	const hasChangedParameter = parameters.some((parameter) => {
		const selection = selections[parameter.id];
		return typeof selection === 'string' && selection !== parameter.defaultValue;
	});
	return hasFilterSelection || hasChangedParameter;
}

function StoryFilterControl({
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
	const debouncedParentSelection = useDebouncedValue(parentSelection, PARENT_SELECTION_DEBOUNCE_MS);
	const isActive = isFilterSelectionActive(filter.filterType, selection, filter.valueType);
	const hasSelection = isActive || (typeof selection === 'string' && selection !== '');
	const isInvalidNumber = filter.valueType === 'number' && hasSelection && !isActive;

	return (
		<div className='nao-filter flex min-w-36 flex-col gap-1' data-active={isActive || undefined}>
			<div className='flex items-center justify-between gap-1'>
				<span className='nao-label text-xs font-medium text-muted-foreground'>{filter.label}</span>
				{isInvalidNumber && <span className='text-xs text-destructive'>Numbers only</span>}
				{hasSelection && (
					<button
						type='button'
						className='rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
						aria-label={`Clear ${filter.label}`}
						onClick={() => onChange(emptySelection(filter.filterType))}
					>
						<X className='size-3' />
					</button>
				)}
			</div>
			{filter.filterType === 'select' || filter.filterType === 'multi_select' ? (
				<StoryFilterOptionsSelect
					filter={filter}
					selection={selection}
					parentSelection={debouncedParentSelection}
					onChange={onChange}
					onOptionError={onOptionError}
					api={api}
				/>
			) : filter.filterType === 'date_range' ? (
				<RangeFilter value={Array.isArray(selection) ? selection : []} onChange={onChange} />
			) : filter.filterType === 'text' ? (
				<TextFilter
					filter={filter}
					value={typeof selection === 'string' ? selection : ''}
					onChange={onChange}
				/>
			) : (
				<Input
					type='search'
					className='nao-filter__control h-8 min-w-44 bg-background'
					placeholder='Search'
					value={typeof selection === 'string' ? selection : ''}
					onChange={(event) => onChange(event.target.value)}
				/>
			)}
		</div>
	);
}

function TextFilter({
	filter,
	value,
	onChange,
}: {
	filter: ParsedFilterBlock;
	value: string;
	onChange: (value: string) => void;
}) {
	const valueType = filter.valueType ?? 'string';
	const isInvalid = value.trim() !== '' && !isValidFilterTextValue(value, valueType);

	return (
		<Input
			className='nao-filter__control h-8 min-w-44 bg-background'
			placeholder={valueType === 'number' ? 'Exact number' : 'Exact value'}
			inputMode={valueType === 'number' ? 'decimal' : undefined}
			aria-invalid={isInvalid || undefined}
			value={value}
			onChange={(event) => onChange(event.target.value)}
		/>
	);
}

function getActiveParentSelection(
	filter: ParsedFilterBlock,
	filters: ParsedFilterBlock[],
	selections: Record<string, StoryFilterSelection>,
): StoryFilterSelection | undefined {
	const parent = filter.dependsOn ? filters.find((candidate) => candidate.id === filter.dependsOn) : undefined;
	if (!parent) {
		return undefined;
	}
	const selection = selections[parent.id];
	return isFilterSelectionActive(parent.filterType, selection, parent.valueType) ? selection : undefined;
}

function emptySelection(filterType: ParsedFilterBlock['filterType']): StoryFilterSelection {
	return filterType === 'multi_select' || filterType === 'date_range' ? [] : '';
}

function RangeFilter({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
	return (
		<DateRangePicker
			value={toDateRange(value)}
			onChange={(range) => onChange(fromDateRange(range))}
			placeholder='All dates'
			className='nao-filter__control'
		/>
	);
}

function toDateRange(value: string[]): DateRange | undefined {
	const from = parseDateString(value[0]);
	const to = parseDateString(value[1]);
	if (!from && !to) {
		return undefined;
	}
	return { from, to };
}

function fromDateRange(range: DateRange | undefined): string[] {
	return [range?.from ? format(range.from, 'yyyy-MM-dd') : '', range?.to ? format(range.to, 'yyyy-MM-dd') : ''];
}

function parseDateString(value: string | undefined): Date | undefined {
	if (!value) {
		return undefined;
	}
	const [year, month, day] = value.split('-').map(Number);
	if (!year || !month || !day) {
		return undefined;
	}
	const date = new Date(year, month - 1, day);
	const isSameCalendarDate = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
	return isSameCalendarDate ? date : undefined;
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
