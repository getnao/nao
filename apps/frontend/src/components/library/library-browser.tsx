import { useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { LibraryItemRow } from './library-item-row';
import type { LibraryFilters, LibraryItem, LibrarySectionId, LibraryTypeFilter } from '@/lib/library';
import { NakedInput } from '@/components/ui/input';
import {
	LIBRARY_SECTIONS,
	LIBRARY_TYPE_LABELS,
	countLibraryItemsByType,
	filterLibraryItems,
	groupLibraryItemsBySection,
} from '@/lib/library';
import { cn } from '@/lib/utils';

const TYPE_FILTERS: LibraryTypeFilter[] = ['all', 'story', 'query', 'file', 'chat'];

interface LibraryBrowserProps {
	items: LibraryItem[];
	filters: LibraryFilters;
	onFiltersChange: (filters: LibraryFilters) => void;
	onOpenItem: (item: LibraryItem) => void;
	onMentionItem: (item: LibraryItem) => void;
}

export function LibraryBrowser({ items, filters, onFiltersChange, onOpenItem, onMentionItem }: LibraryBrowserProps) {
	const searchedItems = filterLibraryItems(items, { ...filters, type: 'all' });
	const visibleItems = filterLibraryItems(searchedItems, filters);
	const countsByType = countLibraryItemsByType(searchedItems);
	const itemsBySection = groupLibraryItemsBySection(visibleItems);

	return (
		<div className='flex h-full min-h-0 flex-col'>
			<div className='flex shrink-0 flex-col gap-2 px-4 pb-3 pt-1'>
				<LibrarySearchInput
					value={filters.search}
					onChange={(search) => onFiltersChange({ ...filters, search })}
				/>
				<div className='flex flex-wrap gap-1.5'>
					{TYPE_FILTERS.map((type) => (
						<TypeFilterChip
							key={type}
							type={type}
							count={countsByType[type]}
							isActive={filters.type === type}
							onSelect={() => onFiltersChange({ ...filters, type })}
						/>
					))}
				</div>
			</div>

			<div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-6'>
				{LIBRARY_SECTIONS.map((section) => (
					<LibrarySection
						key={section.id}
						sectionId={section.id}
						title={section.title}
						emptyLabel={section.emptyLabel}
						items={itemsBySection[section.id]}
						onOpenItem={onOpenItem}
						onMentionItem={onMentionItem}
					/>
				))}
				<p className='px-3 text-center text-[11px] text-muted-foreground'>
					Drag an item into the chat input, or type @ to reference it in your next message.
				</p>
			</div>
		</div>
	);
}

function LibrarySearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
	return (
		<label className='flex h-9 items-center gap-2 rounded-lg border bg-background px-3 text-sm focus-within:ring-2 focus-within:ring-ring/40'>
			<Search className='size-3.5 shrink-0 text-muted-foreground' />
			<NakedInput
				value={value}
				onChange={(event) => onChange(event.target.value)}
				placeholder='Search by name, chat or owner'
				className='min-w-0 flex-1'
				aria-label='Search library'
			/>
			{value && (
				<button
					type='button'
					onClick={() => onChange('')}
					aria-label='Clear search'
					className='cursor-pointer text-muted-foreground hover:text-foreground'
				>
					<X className='size-3.5' />
				</button>
			)}
		</label>
	);
}

interface TypeFilterChipProps {
	type: LibraryTypeFilter;
	count: number;
	isActive: boolean;
	onSelect: () => void;
}

function TypeFilterChip({ type, count, isActive, onSelect }: TypeFilterChipProps) {
	return (
		<button
			type='button'
			onClick={onSelect}
			aria-pressed={isActive}
			className={cn(
				'flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
				isActive
					? 'border-foreground bg-foreground text-background'
					: 'text-muted-foreground hover:border-foreground/40 hover:text-foreground',
			)}
		>
			<span>{type === 'all' ? 'All' : LIBRARY_TYPE_LABELS[type].plural}</span>
			<span className={cn('tabular-nums', isActive ? 'opacity-70' : 'opacity-60')}>{count}</span>
		</button>
	);
}

interface LibrarySectionProps {
	sectionId: LibrarySectionId;
	title: string;
	emptyLabel: string;
	items: LibraryItem[];
	onOpenItem: (item: LibraryItem) => void;
	onMentionItem: (item: LibraryItem) => void;
}

function LibrarySection({ sectionId, title, emptyLabel, items, onOpenItem, onMentionItem }: LibrarySectionProps) {
	const [isCollapsed, setIsCollapsed] = useState(false);

	return (
		<section className='flex flex-col gap-0.5' data-library-section={sectionId}>
			<button
				type='button'
				onClick={() => setIsCollapsed((value) => !value)}
				aria-expanded={!isCollapsed}
				className='flex w-full cursor-pointer items-center gap-1.5 px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground'
			>
				<ChevronDown className={cn('size-3 transition-transform', isCollapsed && '-rotate-90')} />
				<span className='flex-1 text-left'>{title}</span>
				<span className='tabular-nums'>{items.length}</span>
			</button>
			{!isCollapsed &&
				(items.length > 0 ? (
					items.map((item) => (
						<LibraryItemRow key={item.id} item={item} onOpen={onOpenItem} onMention={onMentionItem} />
					))
				) : (
					<p className='px-4 py-2 text-xs text-muted-foreground'>{emptyLabel}</p>
				))}
		</section>
	);
}
