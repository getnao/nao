import { Fragment } from 'react';
import { FolderPlus } from 'lucide-react';
import type { StoryPanelDisplayMode } from '@nao/shared/types';
import type { ExplorerEntry, FolderItem, StoriesFilters, StoryItem } from '@/lib/stories-page';
import { countActiveFilters, DEFAULT_FILTERS, isSystemFolder } from '@/lib/stories-page';
import { FolderCard } from '@/components/stories-folder-card';
import {
	CertifiedStoriesEmptyState,
	StoryCard,
	StoriesEmptyState,
	StoriesNoResults,
} from '@/components/stories-groups';
import { usePermissions } from '@/hooks/use-permissions';
import { cn } from '@/lib/utils';

const GRID_CLASS = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3';

export function StoriesExplorer({
	entries,
	displayMode,
	showArchived,
	filters = DEFAULT_FILTERS,
	searchQuery,
	currentFolderId,
	currentUserName,
	onMoveToFolder,
	onModifyFolder,
	onMoveFolder,
	onDeleteFolder,
	onArchiveFolder,
	onRestoreFolder,
	onNewFolder,
	selectedStoryIds,
	selectedFolderIds,
	onToggleStory,
	onToggleFolder,
	selectionMode = false,
}: {
	entries: ExplorerEntry[];
	displayMode: StoryPanelDisplayMode;
	showArchived: boolean;
	filters?: StoriesFilters;
	searchQuery: string;
	currentFolderId: string | null;
	currentUserName: string;
	onMoveToFolder: (item: StoryItem) => void;
	onModifyFolder: (folder: FolderItem) => void;
	onMoveFolder: (folder: FolderItem) => void;
	onDeleteFolder: (folder: FolderItem) => void;
	onArchiveFolder: (folder: FolderItem) => void;
	onRestoreFolder: (folder: FolderItem) => void;
	onNewFolder: () => void;
	selectedStoryIds: Set<string>;
	selectedFolderIds: Set<string>;
	onToggleStory: (storyId: string) => void;
	onToggleFolder: (folderId: string) => void;
	selectionMode?: boolean;
}) {
	const { isViewer } = usePermissions();
	const isInSharedWithMe = currentFolderId === '__shared_with_me__';
	const hasSearch = searchQuery.trim() !== '';
	const activeFilterCount = countActiveFilters(filters);
	const isShowingResults = hasSearch || activeFilterCount > 0;
	const canCreateFolder = !showArchived && !isViewer && !isInSharedWithMe && !isShowingResults;
	const moveToFolderHandler = isViewer || isInSharedWithMe ? undefined : onMoveToFolder;
	const selectionActive = selectionMode || selectedStoryIds.size + selectedFolderIds.size > 0;

	if (entries.length === 0) {
		if (!hasSearch && !showArchived && activeFilterCount === 1 && filters.certifiedOnly) {
			return <CertifiedStoriesEmptyState />;
		}
		if (isShowingResults) {
			return <StoriesNoResults query={searchQuery} />;
		}
		if (!showArchived) {
			return (
				<FolderEmptyState
					onNewFolder={onNewFolder}
					displayMode={displayMode}
					canCreateFolder={canCreateFolder}
					isRoot={!currentFolderId}
				/>
			);
		}
		return <StoriesEmptyState />;
	}

	const folders = entries.filter((e) => e.kind === 'folder');
	const stories = entries.filter((e) => e.kind === 'story');

	if (displayMode === 'lines') {
		const lastSystemFolderIndex = entries.reduce(
			(acc, entry, index) => (entry.kind === 'folder' && isSystemFolder(entry.folder) ? index : acc),
			-1,
		);
		return (
			<div className='flex flex-col gap-1'>
				{canCreateFolder && lastSystemFolderIndex === -1 && <NewFolderRow onClick={onNewFolder} />}
				{entries.map((entry, index) => {
					const newFolderRow = canCreateFolder && index === lastSystemFolderIndex && (
						<NewFolderRow onClick={onNewFolder} />
					);
					if (entry.kind === 'folder') {
						return (
							<Fragment key={`f-${entry.folder.id}`}>
								<FolderCard
									folder={entry.folder}
									displayMode='lines'
									currentUserName={currentUserName}
									onModify={onModifyFolder}
									onMove={onMoveFolder}
									onDelete={onDeleteFolder}
									onArchive={onArchiveFolder}
									onRestore={onRestoreFolder}
									selected={selectedFolderIds.has(entry.folder.id)}
									selectionActive={selectionActive}
									onToggleSelect={onToggleFolder}
								/>
								{newFolderRow}
							</Fragment>
						);
					}
					return (
						<Fragment key={`s-${entry.story.storyId}`}>
							<StoryCard
								item={entry.story}
								displayMode='lines'
								showArchived={showArchived}
								onMoveToFolder={moveToFolderHandler}
								selected={selectedStoryIds.has(entry.story.storyId)}
								selectionActive={selectionActive}
								onToggleSelect={onToggleStory}
							/>
							{newFolderRow}
						</Fragment>
					);
				})}
			</div>
		);
	}

	return (
		<div className='flex flex-col gap-8'>
			{(folders.length > 0 || canCreateFolder) && (
				<section>
					<SectionLabel label='Folders' count={folders.length} />
					<div className={GRID_CLASS}>
						{folders.map((entry) => (
							<FolderCard
								key={`f-${entry.folder.id}`}
								folder={entry.folder}
								displayMode='grid'
								currentUserName={currentUserName}
								onModify={onModifyFolder}
								onMove={onMoveFolder}
								onDelete={onDeleteFolder}
								onArchive={onArchiveFolder}
								onRestore={onRestoreFolder}
								selected={selectedFolderIds.has(entry.folder.id)}
								selectionActive={selectionActive}
								onToggleSelect={onToggleFolder}
							/>
						))}
						{canCreateFolder && <NewFolderCard onClick={onNewFolder} />}
					</div>
				</section>
			)}
			{stories.length > 0 && (
				<section>
					<SectionLabel label={isShowingResults ? 'Results' : 'Stories'} count={stories.length} />
					<div className={GRID_CLASS}>
						{stories.map((entry) => (
							<StoryCard
								key={`s-${entry.story.storyId}`}
								item={entry.story}
								displayMode='grid'
								showArchived={showArchived}
								onMoveToFolder={moveToFolderHandler}
								selected={selectedStoryIds.has(entry.story.storyId)}
								selectionActive={selectionActive}
								onToggleSelect={onToggleStory}
							/>
						))}
					</div>
				</section>
			)}
		</div>
	);
}

function SectionLabel({ label, count }: { label: string; count: number }) {
	return (
		<h2 className='flex items-baseline gap-1.5 mb-3 text-sm font-medium text-muted-foreground'>
			{label}
			{count > 0 && <span className='text-xs text-muted-foreground/60 tabular-nums'>{count}</span>}
		</h2>
	);
}

function NewFolderCard({ onClick }: { onClick: () => void }) {
	return (
		<button
			type='button'
			onClick={onClick}
			className={cn(
				'h-10 rounded-md border border-dashed border-muted-foreground/20 px-3',
				'flex items-center gap-2 text-muted-foreground/50',
				'hover:border-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-pointer',
			)}
		>
			<FolderPlus className='size-4 shrink-0' />
			<span className='text-sm truncate'>New folder</span>
		</button>
	);
}

function NewFolderRow({ onClick }: { onClick: () => void }) {
	return (
		<button
			type='button'
			onClick={onClick}
			className='flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground/50 hover:text-muted-foreground hover:bg-sidebar-accent transition-colors cursor-pointer'
		>
			<div className='flex items-center gap-2 flex-1 min-w-0 pl-1.5'>
				<FolderPlus className='size-4 shrink-0' />
				<span className='truncate'>New folder</span>
			</div>
		</button>
	);
}

function FolderEmptyState({
	onNewFolder,
	displayMode,
	canCreateFolder,
	isRoot,
}: {
	onNewFolder: () => void;
	displayMode: StoryPanelDisplayMode;
	canCreateFolder: boolean;
	isRoot: boolean;
}) {
	if (!canCreateFolder) {
		return <StoriesEmptyState />;
	}
	const action =
		displayMode === 'grid' ? (
			<div className={GRID_CLASS}>
				<NewFolderCard onClick={onNewFolder} />
			</div>
		) : (
			<div className='flex flex-col gap-1 text-muted-foreground/50'>
				<NewFolderRow onClick={onNewFolder} />
			</div>
		);
	if (isRoot) {
		return (
			<div className='flex flex-col gap-4'>
				<StoriesEmptyState />
				{action}
			</div>
		);
	}
	return action;
}
