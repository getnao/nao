import { FolderPlus } from 'lucide-react';
import type { StoryPanelDisplayMode } from '@nao/shared/types';
import type { ExplorerEntry, FolderItem, StoryItem } from '@/lib/stories-page';
import { FolderCard } from '@/components/stories-folder-card';
import { StoryCard, StoriesEmptyState, StoriesNoResults } from '@/components/stories-groups';
import { usePermissions } from '@/hooks/use-permissions';
import { cn } from '@/lib/utils';

const GRID_CLASS = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3';

export function StoriesExplorer({
	entries,
	displayMode,
	showArchived,
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
}: {
	entries: ExplorerEntry[];
	displayMode: StoryPanelDisplayMode;
	showArchived: boolean;
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
}) {
	const { isViewer } = usePermissions();
	const isInSharedWithMe = currentFolderId === '__shared_with_me__';
	const canCreateFolder = !showArchived && !isViewer && !isInSharedWithMe;
	const moveToFolderHandler = isViewer || isInSharedWithMe ? undefined : onMoveToFolder;

	if (entries.length === 0) {
		if (searchQuery.trim()) {
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
		return (
			<div className='flex flex-col gap-1'>
				{entries.map((entry) => {
					if (entry.kind === 'folder') {
						return (
							<FolderCard
								key={`f-${entry.folder.id}`}
								folder={entry.folder}
								displayMode='lines'
								currentUserName={currentUserName}
								onModify={onModifyFolder}
								onMove={onMoveFolder}
								onDelete={onDeleteFolder}
								onArchive={onArchiveFolder}
								onRestore={onRestoreFolder}
							/>
						);
					}
					return (
						<StoryCard
							key={`s-${entry.story.id}`}
							item={entry.story}
							displayMode='lines'
							showArchived={showArchived}
							onMoveToFolder={moveToFolderHandler}
						/>
					);
				})}
				{canCreateFolder && <NewFolderRow onClick={onNewFolder} />}
			</div>
		);
	}

	return (
		<div className='flex flex-col gap-4'>
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
					/>
				))}
				{canCreateFolder && <NewFolderCard onClick={onNewFolder} />}
			</div>
			{stories.length > 0 && (
				<div className={GRID_CLASS}>
					{stories.map((entry) => (
						<StoryCard
							key={`s-${entry.story.id}`}
							item={entry.story}
							displayMode='grid'
							showArchived={showArchived}
							onMoveToFolder={moveToFolderHandler}
						/>
					))}
				</div>
			)}
		</div>
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
