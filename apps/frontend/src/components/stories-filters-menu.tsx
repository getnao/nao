import { Activity, Archive, ChevronDown, Globe, ListFilter, ShieldCheck, Star, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { StoriesFilters, StoriesFormatFilter, StoriesOwnerFilter } from '@/lib/stories-page';
import { countActiveFilters, DEFAULT_FILTERS } from '@/lib/stories-page';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export const TOOLBAR_BUTTON_CLASS = 'h-9 gap-1.5 rounded-full border px-3.5 font-normal';

type ToggleFilterKey = 'certifiedOnly' | 'liveOnly' | 'favoritesOnly' | 'sharedOnly';

const TOGGLE_FILTERS: { key: ToggleFilterKey; label: string; icon: LucideIcon }[] = [
	{ key: 'certifiedOnly', label: 'Certified', icon: ShieldCheck },
	{ key: 'liveOnly', label: 'Live', icon: Activity },
	{ key: 'favoritesOnly', label: 'Favorites', icon: Star },
	{ key: 'sharedOnly', label: 'Shared', icon: Globe },
];

const FORMAT_OPTIONS: { value: StoriesFormatFilter; label: string }[] = [
	{ value: 'any', label: 'Any type' },
	{ value: 'custom', label: 'Custom' },
	{ value: 'classic', label: 'Markdown' },
];

const OWNER_OPTIONS: { value: StoriesOwnerFilter; label: string; chipLabel: string }[] = [
	{ value: 'anyone', label: 'Anyone', chipLabel: '' },
	{ value: 'me', label: 'Me', chipLabel: 'Created by me' },
	{ value: 'others', label: 'Others', chipLabel: 'Created by others' },
];

type FiltersProps = {
	filters: StoriesFilters;
	onFiltersChange: (filters: StoriesFilters) => void;
	showArchived: boolean;
	onShowArchivedChange: (value: boolean) => void;
};

export function StoriesFiltersMenu({ filters, onFiltersChange, showArchived, onShowArchivedChange }: FiltersProps) {
	const activeCount = countActiveFilters(filters) + Number(showArchived);

	function clearAll() {
		onFiltersChange(DEFAULT_FILTERS);
		onShowArchivedChange(false);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant='ghost' className={cn(TOOLBAR_BUTTON_CLASS, activeCount > 0 && 'bg-accent')}>
					<ListFilter />
					Filters
					{activeCount > 0 && (
						<span className='rounded-full bg-foreground px-1.5 text-[10px] font-medium leading-4 text-background tabular-nums'>
							{activeCount}
						</span>
					)}
					<ChevronDown className='size-3.5 text-muted-foreground' />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-56'>
				<DropdownMenuLabel>Show only</DropdownMenuLabel>
				{TOGGLE_FILTERS.map(({ key, label, icon: Icon }) => (
					<DropdownMenuCheckboxItem
						key={key}
						checked={filters[key]}
						onCheckedChange={(checked) => onFiltersChange({ ...filters, [key]: checked })}
						onSelect={(event) => event.preventDefault()}
					>
						<Icon />
						{label}
					</DropdownMenuCheckboxItem>
				))}
				<DropdownMenuCheckboxItem
					checked={showArchived}
					onCheckedChange={onShowArchivedChange}
					onSelect={(event) => event.preventDefault()}
				>
					<Archive />
					Archived
				</DropdownMenuCheckboxItem>
				<DropdownMenuSeparator />
				<DropdownMenuLabel>Type</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={filters.format}
					onValueChange={(format) => onFiltersChange({ ...filters, format: format as StoriesFormatFilter })}
				>
					{FORMAT_OPTIONS.map((option) => (
						<DropdownMenuRadioItem
							key={option.value}
							value={option.value}
							indicator='check'
							onSelect={(event) => event.preventDefault()}
						>
							{option.label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				<DropdownMenuSeparator />
				<DropdownMenuLabel>Created by</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={filters.owner}
					onValueChange={(owner) => onFiltersChange({ ...filters, owner: owner as StoriesOwnerFilter })}
				>
					{OWNER_OPTIONS.map((option) => (
						<DropdownMenuRadioItem
							key={option.value}
							value={option.value}
							indicator='check'
							onSelect={(event) => event.preventDefault()}
						>
							{option.label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				{activeCount > 0 && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem onSelect={clearAll} className='py-1 text-sm font-normal'>
							Clear all filters
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function StoriesActiveFilters({ filters, onFiltersChange, showArchived, onShowArchivedChange }: FiltersProps) {
	const activeCount = countActiveFilters(filters) + Number(showArchived);

	if (activeCount === 0) {
		return null;
	}

	const formatChipLabel =
		filters.format === 'any' ? null : FORMAT_OPTIONS.find((o) => o.value === filters.format)?.label;
	const ownerChipLabel = OWNER_OPTIONS.find((option) => option.value === filters.owner)?.chipLabel;

	function clearAll() {
		onFiltersChange(DEFAULT_FILTERS);
		onShowArchivedChange(false);
	}

	return (
		<div className='flex flex-wrap items-center gap-2'>
			{showArchived && <FilterChip label='Archived' onRemove={() => onShowArchivedChange(false)} />}
			{TOGGLE_FILTERS.filter(({ key }) => filters[key]).map(({ key, label }) => (
				<FilterChip key={key} label={label} onRemove={() => onFiltersChange({ ...filters, [key]: false })} />
			))}
			{formatChipLabel && (
				<FilterChip label={formatChipLabel} onRemove={() => onFiltersChange({ ...filters, format: 'any' })} />
			)}
			{ownerChipLabel && (
				<FilterChip label={ownerChipLabel} onRemove={() => onFiltersChange({ ...filters, owner: 'anyone' })} />
			)}
			{activeCount > 1 && (
				<button
					type='button'
					onClick={clearAll}
					className='text-xs text-muted-foreground hover:text-foreground cursor-pointer'
				>
					Clear all
				</button>
			)}
		</div>
	);
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
	return (
		<span className='inline-flex h-6 items-center gap-1 rounded-full bg-accent pl-2.5 pr-1 text-xs'>
			{label}
			<button
				type='button'
				onClick={onRemove}
				aria-label={`Remove ${label} filter`}
				className='inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground cursor-pointer'
			>
				<X className='size-3' />
			</button>
		</span>
	);
}
