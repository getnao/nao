import { Check, ChevronDown, ChevronsDown, SearchX } from 'lucide-react';
import { useState } from 'react';
import type { UIEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePagedFilterOptions } from '@/hooks/use-paged-filter-options';
import { FILTER_OPTIONS_PAGE_SIZE, formatFilterResultSummary } from '@/lib/story-filter-options';
import { cn } from '@/lib/utils';

const ALL_ITEM_VALUE = '__nao_filter_all__';
const LOAD_MORE_ITEM_VALUE = '__nao_filter_load_more__';
const SELECTED_ITEM_PREFIX = '__nao_filter_selected__:';
const AUTO_LOAD_THRESHOLD_PX = 8;

type PickerMode = 'single' | 'multi';

interface OptionPickerProps {
	label: string;
	mode: PickerMode;
	options: string[];
	truncated: boolean;
	value: string[];
	onChange: (value: string[]) => void;
}

export function StoryFilterOptionPicker(props: OptionPickerProps) {
	const [open, setOpen] = useState(false);
	const { value } = props;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant='outline'
					size='sm'
					className={cn(
						'h-8 min-w-36 max-w-60 justify-between gap-2 bg-background font-normal',
						value.length === 0 && 'text-muted-foreground',
					)}
				>
					<span className='truncate'>{formatTriggerLabel(value)}</span>
					<ChevronDown className='size-3.5 shrink-0 opacity-60' />
				</Button>
			</PopoverTrigger>
			<PopoverContent className='w-72 p-0' align='start'>
				<OptionPickerContent {...props} onClose={() => setOpen(false)} />
			</PopoverContent>
		</Popover>
	);
}

function OptionPickerContent({
	label,
	mode,
	options,
	truncated,
	value,
	onChange,
	onClose,
}: OptionPickerProps & { onClose: () => void }) {
	const [search, setSearch] = useState('');
	const paged = usePagedFilterOptions(options, search);

	const handleToggle = (option: string) => {
		if (mode === 'single') {
			onChange(value.includes(option) ? [] : [option]);
			onClose();
			return;
		}
		onChange(value.includes(option) ? value.filter((candidate) => candidate !== option) : [...value, option]);
	};

	const handleClearAll = () => {
		onChange([]);
		if (mode === 'single') {
			onClose();
		}
	};

	const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
		const list = event.currentTarget;
		const isNearBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - AUTO_LOAD_THRESHOLD_PX;
		if (isNearBottom && paged.hasMore) {
			paged.loadMore();
		}
	};

	const isSearching = paged.search.length > 0;
	const pinnedSelection = mode === 'multi' && !isSearching ? value : [];
	const visibleOptions = paged.options.filter((option) => !pinnedSelection.includes(option));

	return (
		<Command shouldFilter={false} loop>
			<CommandInput value={search} onValueChange={setSearch} placeholder={`Search ${label.toLowerCase()}…`} />
			<div className='flex h-7 items-center justify-between gap-2 border-b bg-muted/30 px-3 text-[11px] text-muted-foreground'>
				<span className='min-w-0 truncate'>
					{formatFilterResultSummary(paged.search, paged.options.length, paged.total)}
				</span>
				{mode === 'multi' && value.length > 0 && (
					<span className='shrink-0 font-medium text-foreground'>{value.length} selected</span>
				)}
			</div>
			<CommandList className='max-h-72' onScroll={handleListScroll}>
				{paged.total === 0 && pinnedSelection.length === 0 ? (
					<NoMatches search={paged.search} onClearSearch={() => setSearch('')} />
				) : (
					<>
						{pinnedSelection.length > 0 && (
							<CommandGroup heading={`Selected (${pinnedSelection.length})`}>
								{pinnedSelection.map((option) => (
									<OptionItem
										key={option}
										itemValue={`${SELECTED_ITEM_PREFIX}${option}`}
										option={option}
										mode={mode}
										isSelected
										onSelect={() => handleToggle(option)}
									/>
								))}
							</CommandGroup>
						)}
						<CommandGroup heading={pinnedSelection.length > 0 ? 'All options' : undefined}>
							{mode === 'single' && !isSearching && (
								<CommandItem value={ALL_ITEM_VALUE} onSelect={handleClearAll}>
									<span className='flex-1 text-muted-foreground'>All</span>
									{value.length === 0 && <Check className='size-3.5' />}
								</CommandItem>
							)}
							{visibleOptions.map((option) => (
								<OptionItem
									key={option}
									itemValue={option}
									option={option}
									search={paged.search}
									mode={mode}
									isSelected={value.includes(option)}
									onSelect={() => handleToggle(option)}
								/>
							))}
							<ListFooter
								hasMore={paged.hasMore}
								remaining={paged.total - paged.options.length}
								shown={paged.options.length}
								truncatedAt={truncated ? options.length : null}
								onLoadMore={paged.loadMore}
							/>
						</CommandGroup>
					</>
				)}
			</CommandList>
			{mode === 'multi' && (
				<div className='flex items-center justify-between border-t px-2 py-1.5'>
					<Button
						variant='ghost'
						size='sm'
						className='h-7 px-2 text-xs'
						disabled={value.length === 0}
						onClick={handleClearAll}
					>
						Clear selection
					</Button>
					<Button size='sm' className='h-7 px-3 text-xs' onClick={onClose}>
						Done
					</Button>
				</div>
			)}
		</Command>
	);
}

function formatTriggerLabel(value: string[]): string {
	if (value.length === 0) {
		return 'All';
	}
	if (value.length === 1) {
		return value[0];
	}
	return `${value[0]} +${value.length - 1}`;
}

function OptionItem({
	itemValue,
	option,
	search = '',
	mode,
	isSelected,
	onSelect,
}: {
	itemValue: string;
	option: string;
	search?: string;
	mode: PickerMode;
	isSelected: boolean;
	onSelect: () => void;
}) {
	return (
		<CommandItem value={itemValue} onSelect={onSelect} className='gap-2'>
			{mode === 'multi' && <CheckboxIndicator checked={isSelected} />}
			<span className='flex-1 truncate' title={option}>
				<HighlightedText text={option} search={search} />
			</span>
			{mode === 'single' && isSelected && <Check className='size-3.5' />}
		</CommandItem>
	);
}

function CheckboxIndicator({ checked }: { checked: boolean }) {
	return (
		<span
			aria-hidden
			className={cn(
				'flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-muted shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]',
				checked && 'bg-brand-gradient text-background shadow-none dark:shadow-none',
			)}
		>
			{checked && <Check className='size-3 text-background' />}
		</span>
	);
}

function HighlightedText({ text, search }: { text: string; search: string }) {
	const matchIndex = search ? text.toLowerCase().indexOf(search.toLowerCase()) : -1;
	if (matchIndex < 0) {
		return <>{text}</>;
	}
	const matchEnd = matchIndex + search.length;
	return (
		<>
			{text.slice(0, matchIndex)}
			<mark className='rounded-sm bg-yellow-200/70 text-foreground dark:bg-yellow-500/30'>
				{text.slice(matchIndex, matchEnd)}
			</mark>
			{text.slice(matchEnd)}
		</>
	);
}

function ListFooter({
	hasMore,
	remaining,
	shown,
	truncatedAt,
	onLoadMore,
}: {
	hasMore: boolean;
	remaining: number;
	shown: number;
	truncatedAt: number | null;
	onLoadMore: () => void;
}) {
	if (hasMore) {
		return (
			<CommandItem
				value={LOAD_MORE_ITEM_VALUE}
				onSelect={onLoadMore}
				className='mt-1 justify-center border-t border-dashed text-xs text-muted-foreground'
			>
				<ChevronsDown className='size-3.5' />
				Load {Math.min(FILTER_OPTIONS_PAGE_SIZE, remaining)} more
				<span className='opacity-70'>· {remaining.toLocaleString()} remaining</span>
			</CommandItem>
		);
	}
	if (truncatedAt !== null) {
		return (
			<div className='px-2 py-2 text-center text-[11px] text-muted-foreground'>
				Only the first {truncatedAt.toLocaleString()} values are available
			</div>
		);
	}
	if (shown > FILTER_OPTIONS_PAGE_SIZE) {
		return (
			<div className='px-2 py-2 text-center text-[11px] text-muted-foreground'>
				All {shown.toLocaleString()} options loaded
			</div>
		);
	}
	return null;
}

function NoMatches({ search, onClearSearch }: { search: string; onClearSearch: () => void }) {
	return (
		<div className='flex flex-col items-center gap-2 px-4 py-6 text-center'>
			<SearchX className='size-5 text-muted-foreground' />
			<p className='text-sm text-muted-foreground'>
				{search ? (
					<>
						No options match <span className='font-medium text-foreground'>“{search}”</span>
					</>
				) : (
					'No options available'
				)}
			</p>
			{search && (
				<Button variant='outline' size='sm' className='h-7 text-xs' onClick={onClearSearch}>
					Clear search
				</Button>
			)}
		</div>
	);
}
