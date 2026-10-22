import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SortDirection, SortField, SortState } from '@/lib/stories-page';
import { defaultSortDirection, isDateSortField } from '@/lib/stories-page';
import { TOOLBAR_BUTTON_CLASS } from '@/components/stories-filters-menu';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SimpleTooltip } from '@/components/ui/tooltip';

const SORT_FIELD_LABELS: Record<SortField, string> = {
	updated: 'Last updated',
	created: 'Date created',
	views: 'Views',
	name: 'Name',
	owner: 'Owner',
};

const SORT_FIELDS: SortField[] = ['updated', 'created', 'views', 'name', 'owner'];

const DIRECTION_ICONS: Record<SortDirection, LucideIcon> = {
	asc: ArrowUpNarrowWide,
	desc: ArrowDownWideNarrow,
};

export function StoriesSortMenu({ value, onChange }: { value: SortState; onChange: (next: SortState) => void }) {
	const DirectionIcon = DIRECTION_ICONS[value.direction];
	const directionLabel = getDirectionOptions(value.field).find(
		(option) => option.direction === value.direction,
	)?.label;
	const description = `Sorted by ${SORT_FIELD_LABELS[value.field].toLowerCase()}, ${directionLabel?.toLowerCase()}`;

	function handleFieldChange(field: SortField) {
		onChange({ field, direction: defaultSortDirection(field) });
	}

	return (
		<DropdownMenu>
			<SimpleTooltip content={description}>
				<DropdownMenuTrigger asChild>
					<Button variant='ghost' className={TOOLBAR_BUTTON_CLASS} aria-label={description}>
						<DirectionIcon />
						<span className='hidden md:inline text-muted-foreground'>Sort:</span>
						{SORT_FIELD_LABELS[value.field]}
						<ChevronDown className='size-3.5 text-muted-foreground' />
					</Button>
				</DropdownMenuTrigger>
			</SimpleTooltip>
			<DropdownMenuContent align='end' className='w-48'>
				<DropdownMenuLabel>Sort by</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={value.field}
					onValueChange={(field) => handleFieldChange(field as SortField)}
				>
					{SORT_FIELDS.map((field) => (
						<DropdownMenuRadioItem key={field} value={field} indicator='check'>
							{SORT_FIELD_LABELS[field]}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				<DropdownMenuSeparator />
				<DropdownMenuLabel>Order</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={value.direction}
					onValueChange={(direction) => onChange({ ...value, direction: direction as SortDirection })}
				>
					{getDirectionOptions(value.field).map(({ direction, label }) => {
						const OptionIcon = DIRECTION_ICONS[direction];
						return (
							<DropdownMenuRadioItem key={direction} value={direction} indicator='check'>
								<OptionIcon />
								{label}
							</DropdownMenuRadioItem>
						);
					})}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function getDirectionOptions(field: SortField): { direction: SortDirection; label: string }[] {
	if (field === 'views') {
		return [
			{ direction: 'desc', label: 'Most viewed first' },
			{ direction: 'asc', label: 'Least viewed first' },
		];
	}
	if (isDateSortField(field)) {
		return [
			{ direction: 'desc', label: 'Newest first' },
			{ direction: 'asc', label: 'Oldest first' },
		];
	}
	return [
		{ direction: 'asc', label: 'A to Z' },
		{ direction: 'desc', label: 'Z to A' },
	];
}
