import { LayoutGrid, List, ListChecks, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { StoryPanelDisplayMode } from '@nao/shared/types';
import type { SortState, StoriesFilters } from '@/lib/stories-page';
import { SearchBar } from '@/components/search-bar';
import { StoriesActiveFilters, StoriesFiltersMenu, TOOLBAR_BUTTON_CLASS } from '@/components/stories-filters-menu';
import { StoriesSortMenu } from '@/components/stories-sort-menu';
import { Button } from '@/components/ui/button';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { usePermissions } from '@/hooks/use-permissions';
import { cn } from '@/lib/utils';

export function StoriesToolbar({
	searchQuery,
	onSearchChange,
	searchPlaceholder,
	filters,
	onFiltersChange,
	showArchived,
	onShowArchivedChange,
	sort,
	onSortChange,
	displayMode,
	onDisplayModeChange,
	selectionActive,
	onToggleSelection,
	className,
}: {
	searchQuery: string;
	onSearchChange: (value: string) => void;
	searchPlaceholder: string;
	filters: StoriesFilters;
	onFiltersChange: (filters: StoriesFilters) => void;
	showArchived: boolean;
	onShowArchivedChange: (value: boolean) => void;
	sort: SortState;
	onSortChange: (next: SortState) => void;
	displayMode: StoryPanelDisplayMode;
	onDisplayModeChange: (value: StoryPanelDisplayMode) => void;
	selectionActive: boolean;
	onToggleSelection: () => void;
	className?: string;
}) {
	const { isViewer } = usePermissions();
	const filterProps = { filters, onFiltersChange, showArchived, onShowArchivedChange };

	return (
		<div className={cn('flex flex-col gap-3', className)}>
			<div className='flex flex-wrap items-center gap-2'>
				<SearchBar
					value={searchQuery}
					onChange={onSearchChange}
					placeholder={searchPlaceholder}
					ariaLabel='Search stories'
					size='lg'
					focusShortcutKey='/'
					className='basis-full sm:basis-0 sm:flex-1'
				/>
				<StoriesFiltersMenu {...filterProps} />
				<StoriesSortMenu value={sort} onChange={onSortChange} />
				{!isViewer && <SelectionToggle active={selectionActive} onToggle={onToggleSelection} />}
				<DisplayModeToggle value={displayMode} onChange={onDisplayModeChange} />
			</div>
			<StoriesActiveFilters {...filterProps} />
		</div>
	);
}

function SelectionToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
	return (
		<Button variant='ghost' onClick={onToggle} className={cn(TOOLBAR_BUTTON_CLASS, active && 'bg-accent')}>
			{active ? <X /> : <ListChecks />}
			{active ? 'Cancel' : 'Select'}
		</Button>
	);
}

function DisplayModeToggle({
	value,
	onChange,
}: {
	value: StoryPanelDisplayMode;
	onChange: (value: StoryPanelDisplayMode) => void;
}) {
	return (
		<div className='flex h-9 items-center gap-0.5 rounded-full border p-0.5'>
			<DisplayModeButton
				label='Grid view'
				active={value === 'grid'}
				onClick={() => onChange('grid')}
				icon={<LayoutGrid />}
			/>
			<DisplayModeButton
				label='List view'
				active={value === 'lines'}
				onClick={() => onChange('lines')}
				icon={<List />}
			/>
		</div>
	);
}

function DisplayModeButton({
	label,
	active,
	onClick,
	icon,
}: {
	label: string;
	active: boolean;
	onClick: () => void;
	icon: ReactNode;
}) {
	return (
		<SimpleTooltip content={label}>
			<Button
				variant='ghost'
				size='icon-sm'
				onClick={onClick}
				aria-label={label}
				aria-pressed={active}
				className={cn('rounded-full hover:rounded-full', active && 'bg-accent')}
			>
				{icon}
			</Button>
		</SimpleTooltip>
	);
}
