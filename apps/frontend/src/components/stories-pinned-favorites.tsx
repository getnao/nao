import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { FavoriteEntry, FolderItem, StoryItem } from '@/lib/stories-page';
import { FolderCard } from '@/components/stories-folder-card';
import { StoryCard } from '@/components/stories-groups';
import { cn } from '@/lib/utils';

const PINNED_COLLAPSED_KEY = 'stories-pinned-collapsed';
const FAVORITES_COLLAPSED_KEY = 'stories-favorites-collapsed';

const GRID_CLASS = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3';

const COLUMN_BREAKPOINTS = [
	{ query: '(min-width: 1536px)', columns: 6 },
	{ query: '(min-width: 1280px)', columns: 5 },
	{ query: '(min-width: 1024px)', columns: 4 },
	{ query: '(min-width: 640px)', columns: 3 },
] as const;

const DEFAULT_COLUMNS = 2;

export function PromotedSections({
	pinned,
	favorites,
	currentUserName,
	onModifyFolder,
	onMoveFolder,
	onDeleteFolder,
	onArchiveFolder,
	onRestoreFolder,
	className,
}: {
	pinned: StoryItem[];
	favorites: FavoriteEntry[];
	currentUserName: string;
	onModifyFolder: (folder: FolderItem) => void;
	onMoveFolder: (folder: FolderItem) => void;
	onDeleteFolder: (folder: FolderItem) => void;
	onArchiveFolder: (folder: FolderItem) => void;
	onRestoreFolder: (folder: FolderItem) => void;
	className?: string;
}) {
	const columns = useGridColumns();
	const [pinnedCollapsed, togglePinned] = useCollapsedState(PINNED_COLLAPSED_KEY);
	const [favoritesCollapsed, toggleFavorites] = useCollapsedState(FAVORITES_COLLAPSED_KEY);

	const groups = [
		{
			label: 'Pinned',
			dragIdPrefix: 'pinned',
			items: storiesToEntries(pinned),
			collapsed: pinnedCollapsed,
			onToggle: togglePinned,
		},
		{
			label: 'Favorites',
			dragIdPrefix: 'favorites',
			items: favorites,
			collapsed: favoritesCollapsed,
			onToggle: toggleFavorites,
		},
	].filter((g) => g.items.length > 0);

	if (groups.length === 0) {
		return null;
	}

	const totalItems = groups.reduce((sum, g) => sum + g.items.length, 0);
	const sideBySide = groups.length === 2 && totalItems <= columns;
	const folderHandlers = {
		onModify: onModifyFolder,
		onMove: onMoveFolder,
		onDelete: onDeleteFolder,
		onArchive: onArchiveFolder,
		onRestore: onRestoreFolder,
	};

	if (sideBySide) {
		return (
			<section
				className={cn('grid gap-3', className)}
				style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
			>
				{groups.map((g) => (
					<PromotedGroup
						key={g.label}
						{...g}
						currentUserName={currentUserName}
						folderHandlers={folderHandlers}
						style={{ gridColumn: `span ${g.items.length}` }}
						gridClassName='grid gap-3'
						gridStyle={{ gridTemplateColumns: `repeat(${g.items.length}, minmax(0, 1fr))` }}
					/>
				))}
			</section>
		);
	}

	return (
		<>
			{groups.map((g) => (
				<PromotedGroup
					key={g.label}
					{...g}
					currentUserName={currentUserName}
					folderHandlers={folderHandlers}
					className={cn('mb-6', className)}
				/>
			))}
		</>
	);
}

function storiesToEntries(stories: StoryItem[]): FavoriteEntry[] {
	return stories.map((story) => ({ kind: 'story', story, favoritedAt: story.createdAt }));
}

type FolderHandlers = {
	onModify: (folder: FolderItem) => void;
	onMove: (folder: FolderItem) => void;
	onDelete: (folder: FolderItem) => void;
	onArchive: (folder: FolderItem) => void;
	onRestore: (folder: FolderItem) => void;
};

function PromotedGroup({
	label,
	dragIdPrefix,
	items,
	collapsed,
	onToggle,
	currentUserName,
	folderHandlers,
	className,
	style,
	gridClassName,
	gridStyle,
}: {
	label: string;
	dragIdPrefix: string;
	items: FavoriteEntry[];
	collapsed: boolean;
	onToggle: () => void;
	currentUserName: string;
	folderHandlers: FolderHandlers;
	className?: string;
	style?: CSSProperties;
	gridClassName?: string;
	gridStyle?: CSSProperties;
}) {
	return (
		<section className={className} style={style}>
			<SectionHeader label={label} collapsed={collapsed} onToggle={onToggle} />
			{!collapsed && (
				<div className={gridClassName ?? GRID_CLASS} style={gridStyle}>
					{items.map((entry) => (
						<PromotedItem
							key={entryKey(entry)}
							entry={entry}
							dragIdPrefix={dragIdPrefix}
							currentUserName={currentUserName}
							folderHandlers={folderHandlers}
						/>
					))}
				</div>
			)}
		</section>
	);
}

function PromotedItem({
	entry,
	dragIdPrefix,
	currentUserName,
	folderHandlers,
}: {
	entry: FavoriteEntry;
	dragIdPrefix: string;
	currentUserName: string;
	folderHandlers: FolderHandlers;
}) {
	if (entry.kind === 'story') {
		return <StoryCard item={entry.story} displayMode='grid' showArchived={false} dragIdPrefix={dragIdPrefix} />;
	}
	return (
		<FolderCard
			folder={entry.folder}
			displayMode='grid-large'
			currentUserName={currentUserName}
			onModify={folderHandlers.onModify}
			onMove={folderHandlers.onMove}
			onDelete={folderHandlers.onDelete}
			onArchive={folderHandlers.onArchive}
			onRestore={folderHandlers.onRestore}
		/>
	);
}

function entryKey(entry: FavoriteEntry): string {
	return entry.kind === 'story' ? `story-${entry.story.id}` : `folder-${entry.folder.id}`;
}

function SectionHeader({ label, collapsed, onToggle }: { label: string; collapsed: boolean; onToggle: () => void }) {
	return (
		<button
			type='button'
			className='flex items-center gap-1.5 mb-3 cursor-pointer text-muted-foreground'
			onClick={onToggle}
		>
			<span className='inline-flex size-4 items-center justify-center shrink-0'>
				{collapsed ? <ChevronRight className='size-3.5' /> : <ChevronDown className='size-3.5' />}
			</span>
			<span className='text-sm font-medium'>{label}</span>
		</button>
	);
}

function useCollapsedState(key: string): [boolean, () => void] {
	const [collapsed, setCollapsed] = useState(() => readCollapsed(key));

	function toggle() {
		setCollapsed((prev) => {
			const next = !prev;
			writeCollapsed(key, next);
			return next;
		});
	}

	return [collapsed, toggle];
}

function readCollapsed(key: string): boolean {
	if (typeof window === 'undefined') {
		return false;
	}
	return window.localStorage.getItem(key) === 'true';
}

function writeCollapsed(key: string, value: boolean): void {
	window.localStorage.setItem(key, String(value));
}

function useGridColumns(): number {
	const [columns, setColumns] = useState(getCurrentColumns);

	useEffect(() => {
		const lists = COLUMN_BREAKPOINTS.map(({ query }) => window.matchMedia(query));
		function update() {
			setColumns(getCurrentColumns());
		}
		lists.forEach((list) => list.addEventListener('change', update));
		return () => lists.forEach((list) => list.removeEventListener('change', update));
	}, []);

	return columns;
}

function getCurrentColumns(): number {
	if (typeof window === 'undefined') {
		return DEFAULT_COLUMNS;
	}
	for (const { query, columns } of COLUMN_BREAKPOINTS) {
		if (window.matchMedia(query).matches) {
			return columns;
		}
	}
	return DEFAULT_COLUMNS;
}
