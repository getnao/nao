import {
	DndContext,
	DragOverlay,
	KeyboardSensor,
	pointerWithin,
	PointerSensor,
	rectIntersection,
	useSensor,
	useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { getEventCoordinates } from '@dnd-kit/utilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Archive, Folder, Home } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { BULK_ITEMS_LIMIT } from '@nao/shared';
import type { BulkStoryItem, StoryPanelDisplayMode } from '@nao/shared/types';
import type { CollisionDetection, DragEndEvent, DragStartEvent, Modifier } from '@dnd-kit/core';

import type { FolderItem, SortState, StoryItem } from '@/lib/stories-page';
import type { BreadcrumbNode } from '@/components/stories-folder-breadcrumb';
import { FolderBreadcrumb } from '@/components/stories-folder-breadcrumb';
import { StoriesSelectionBar } from '@/components/stories-selection-bar';
import { FolderCreateDialog } from '@/components/stories-folder-create-dialog';
import { FolderDeleteDialog } from '@/components/stories-folder-delete-dialog';
import { FolderPickerDialog } from '@/components/stories-folder-picker-dialog';
import { MobileHeader } from '@/components/mobile-header';
import { ProjectSwitcher } from '@/components/project-selector';
import { SortHeader } from '@/components/stories-sort-header';
import { StoriesExplorer } from '@/components/stories-explorer';
import { PromotedSections } from '@/components/stories-pinned-favorites';
import { StoriesToolbarControls } from '@/components/stories-toolbar-controls';
import { useProjectSwitch } from '@/hooks/use-project-switch';
import { useSession } from '@/lib/auth-client';
import {
	buildCurrentLevelEntries,
	buildStoryItems,
	filterStories,
	getStoredSetting,
	readStoredSort,
	STORIES_DISPLAY_KEY,
	STORIES_SORT_KEY,
	writeStoredSort,
} from '@/lib/stories-page';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/stories/')({
	validateSearch: (search: Record<string, unknown>) => ({
		folderId: typeof search.folderId === 'string' ? search.folderId : null,
	}),
	component: StoriesPage,
});

const snapCenterToCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
	if (!draggingNodeRect || !activatorEvent) {
		return transform;
	}
	const coords = getEventCoordinates(activatorEvent);
	if (!coords) {
		return transform;
	}
	const offsetX = coords.x - draggingNodeRect.left;
	const offsetY = coords.y - draggingNodeRect.top;
	return {
		...transform,
		x: transform.x + offsetX - draggingNodeRect.width / 2,
		y: transform.y + offsetY - draggingNodeRect.height / 2,
	};
};

const pointerWithinFallbackToRect: CollisionDetection = (args) => {
	const byPointer = pointerWithin(args);
	if (byPointer.length > 0) {
		return byPointer;
	}
	return rectIntersection(args);
};

type DialogState =
	| { kind: 'create' }
	| { kind: 'modify'; folder: FolderItem }
	| { kind: 'delete'; folder: FolderItem }
	| { kind: 'picker-story'; item: StoryItem }
	| { kind: 'picker-folder'; folder: FolderItem }
	| null;

function invalidateFolderAndStoryCaches(queryClient: ReturnType<typeof useQueryClient>): void {
	queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listTree.queryKey() });
	queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listItems.queryKey() });
	queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
	queryClient.invalidateQueries({ queryKey: trpc.story.listStandalone.queryKey() });
	queryClient.invalidateQueries({ queryKey: trpc.story.listArchived.queryKey() });
	queryClient.invalidateQueries({ queryKey: trpc.story.listStandaloneArchived.queryKey() });
	queryClient.invalidateQueries({ queryKey: trpc.story.listSharedArchived.queryKey() });
	queryClient.invalidateQueries({ queryKey: trpc.storyShare.list.queryKey() });
}

function StoriesPage() {
	const { data: session } = useSession();
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	const { folderId: currentFolderId } = Route.useSearch();

	const [displayMode, setDisplayMode] = useState<StoryPanelDisplayMode>(() =>
		getStoredSetting(STORIES_DISPLAY_KEY, ['grid', 'lines'], 'grid'),
	);
	const [sort, setSort] = useState<SortState>(() => readStoredSort());
	const [searchQuery, setSearchQuery] = useState('');
	const [showArchived, setShowArchived] = useState(false);
	const [dialog, setDialog] = useState<DialogState>(null);
	const [activeId, setActiveId] = useState<string | null>(null);

	const [selectedStoryIds, setSelectedStoryIds] = useState<Set<string>>(new Set());
	const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
	const [selectionMode, setSelectionMode] = useState(false);
	const selectionActive = selectionMode || selectedStoryIds.size + selectedFolderIds.size > 0;

	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const projects = useQuery(trpc.project.listForCurrentUser.queryOptions());
	const activeProjectId = project.data?.id;
	const switchProject = useProjectSwitch(activeProjectId);

	const userStories = useQuery(trpc.story.listAll.queryOptions({ projectId: activeProjectId }));
	const standaloneStories = useQuery(trpc.story.listStandalone.queryOptions());
	const sharedStories = useQuery({
		...trpc.storyShare.list.queryOptions({ projectId: activeProjectId ?? '' }),
		enabled: !!activeProjectId,
	});
	const favorites = useQuery({ ...trpc.favorite.list.queryOptions(), enabled: !!activeProjectId });
	const archivedStories = useQuery({
		...trpc.story.listArchived.queryOptions({ projectId: activeProjectId }),
		enabled: showArchived,
	});
	const archivedStandaloneStories = useQuery({
		...trpc.story.listStandaloneArchived.queryOptions(),
		enabled: showArchived,
	});
	const archivedSharedStories = useQuery({
		...trpc.story.listSharedArchived.queryOptions(),
		enabled: showArchived && !!activeProjectId,
	});

	const folderTree = useQuery(trpc.storyFolder.listTree.queryOptions({ archived: false }));
	const archivedFolderTree = useQuery({
		...trpc.storyFolder.listTree.queryOptions({ archived: true }),
		enabled: showArchived,
	});
	const folderItems = useQuery(trpc.storyFolder.listItems.queryOptions());

	const currentUserName = session?.user?.name ?? 'Me';

	const folderItemMap = useMemo(() => {
		const map = new Map<string, string>();
		for (const item of folderItems.data ?? []) {
			map.set(item.storyId, item.folderId);
		}
		return map;
	}, [folderItems.data]);

	const allItems = useMemo(() => {
		if (showArchived) {
			return buildStoryItems({
				userStories: archivedStories.data ?? [],
				standaloneStories: archivedStandaloneStories.data,
				sharedStories: archivedSharedStories.data ?? [],
				currentUserName,
				favoriteStoryIds: favorites.data?.storyIds,
				folderItemMap,
				folders: folderTree.data ?? [],
			});
		}
		return buildStoryItems({
			userStories: userStories.data ?? [],
			standaloneStories: standaloneStories.data,
			sharedStories: sharedStories.data ?? [],
			currentUserName,
			favoriteStoryIds: favorites.data?.storyIds,
			folderItemMap,
			folders: folderTree.data ?? [],
		});
	}, [
		showArchived,
		userStories.data,
		standaloneStories.data,
		sharedStories.data,
		archivedStories.data,
		archivedStandaloneStories.data,
		archivedSharedStories.data,
		currentUserName,
		favorites.data,
		folderItemMap,
		folderTree.data,
	]);

	const filteredItems = useMemo(() => filterStories(allItems, searchQuery), [allItems, searchQuery]);

	const folders = useMemo(
		() => (showArchived ? archivedFolderTree.data : folderTree.data) ?? [],
		[folderTree.data, archivedFolderTree.data, showArchived],
	);

	useEffect(() => {
		const treeLoaded = showArchived ? archivedFolderTree.data !== undefined : folderTree.data !== undefined;
		if (!currentFolderId || !treeLoaded) {
			return;
		}
		const exists = folders.some((f) => f.id === currentFolderId);
		if (!exists) {
			navigate({ to: '/stories', search: { folderId: null }, replace: true });
		}
	}, [currentFolderId, folderTree.data, archivedFolderTree.data, folders, navigate, showArchived]);

	useEffect(() => {
		clearSelection();
	}, [currentFolderId, activeProjectId]);

	const {
		pinned,
		favorites: promotedFavorites,
		entries,
	} = useMemo(() => {
		if (showArchived) {
			const archivedEntries = buildCurrentLevelEntries({
				items: filteredItems,
				folders,
				currentFolderId: currentFolderId ?? null,
				sort,
				currentUserName,
				favoriteFolderIds: favorites.data?.folderIds,
			});
			return { pinned: [], favorites: [], entries: archivedEntries.entries };
		}
		return buildCurrentLevelEntries({
			items: filteredItems,
			folders,
			currentFolderId: currentFolderId ?? null,
			sort,
			currentUserName,
			favoriteFolderIds: favorites.data?.folderIds,
		});
	}, [filteredItems, folders, currentFolderId, sort, currentUserName, showArchived, favorites.data]);

	const breadcrumbPath = useMemo((): BreadcrumbNode[] => {
		const root: BreadcrumbNode = { id: null, name: showArchived ? 'Archived' : 'Root' };
		if (!currentFolderId) {
			return [root];
		}

		const path: BreadcrumbNode[] = [];
		let id: string | null = currentFolderId;
		while (id) {
			const folder = folders.find((f) => f.id === id);
			if (!folder) {
				break;
			}
			path.unshift({
				id: folder.id,
				name: folder.name,
				isPrivate: folder.visibility === 'private' || folder.systemType === 'shared_with_me',
			});
			id = 'parentId' in folder ? (folder.parentId ?? null) : null;
		}
		return [root, ...path];
	}, [currentFolderId, folders, showArchived]);

	const isLoading = showArchived
		? archivedStories.isLoading || archivedStandaloneStories.isLoading
		: userStories.isLoading || standaloneStories.isLoading || sharedStories.isLoading;
	const isEmpty = allItems.length === 0 && folders.length === 0 && !isLoading;

	function handleDisplayChange(mode: StoryPanelDisplayMode) {
		setDisplayMode(mode);
		localStorage.setItem(STORIES_DISPLAY_KEY, mode);
	}

	function handleSortChange(next: SortState) {
		setSort(next);
		writeStoredSort(next);
		localStorage.setItem(STORIES_SORT_KEY, `${next.field}-${next.direction}`);
	}

	function handleShowArchivedChange(value: boolean) {
		setShowArchived(value);
		setSearchQuery('');
		clearSelection();
		if (value) {
			navigate({ to: '/stories', search: { folderId: null } });
		}
	}

	async function handleProjectChange(projectId: string) {
		const didSwitch = await switchProject(projectId);
		if (didSwitch) {
			navigate({ to: '/stories', search: { folderId: null } });
		}
	}

	function clearSelection() {
		setSelectedStoryIds(new Set());
		setSelectedFolderIds(new Set());
		setSelectionMode(false);
	}

	function toggleSelectionMode() {
		if (selectionActive) {
			clearSelection();
		} else {
			setSelectionMode(true);
		}
	}

	function deselectStoryIds(storyIds: string[]) {
		setSelectedStoryIds((prev) => {
			const next = new Set(prev);
			for (const id of storyIds) {
				next.delete(id);
			}
			return next;
		});
	}

	function deselectFolderIds(folderIds: string[]) {
		setSelectedFolderIds((prev) => {
			const next = new Set(prev);
			for (const id of folderIds) {
				next.delete(id);
			}
			return next;
		});
	}

	function toggleStorySelection(storyId: string) {
		setSelectedStoryIds((prev) => {
			const next = new Set(prev);
			if (next.has(storyId)) {
				next.delete(storyId);
			} else if (next.size < BULK_ITEMS_LIMIT) {
				next.add(storyId);
			}
			return next;
		});
	}

	function toggleFolderSelection(folderId: string) {
		setSelectedFolderIds((prev) => {
			const next = new Set(prev);
			if (next.has(folderId)) {
				next.delete(folderId);
			} else if (next.size < BULK_ITEMS_LIMIT) {
				next.add(folderId);
			}
			return next;
		});
	}

	const moveStoryMutation = useMutation(
		trpc.storyFolder.moveStory.mutationOptions({
			onMutate: async ({ storyId, folderId }) => {
				const queryKey = trpc.storyFolder.listItems.queryKey();
				await queryClient.cancelQueries({ queryKey });
				const previous = queryClient.getQueryData<{ storyId: string; folderId: string }[]>(queryKey);
				queryClient.setQueryData<{ storyId: string; folderId: string }[]>(queryKey, (old) => {
					const filtered = (old ?? []).filter((i) => i.storyId !== storyId);
					return folderId ? [...filtered, { storyId, folderId }] : filtered;
				});
				return { previous };
			},
			onError: (_err, _vars, ctx) => {
				if (ctx?.previous !== undefined) {
					queryClient.setQueryData(trpc.storyFolder.listItems.queryKey(), ctx.previous);
				}
			},
			onSettled: () => {
				queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listItems.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listTree.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.storyShare.list.queryKey() });
			},
		}),
	);

	const moveFolderMutation = useMutation(
		trpc.storyFolder.move.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listTree.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listItems.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.storyShare.list.queryKey() });
			},
		}),
	);

	const archiveFolderMutation = useMutation(
		trpc.storyFolder.archive.mutationOptions({
			onSuccess: () => invalidateFolderAndStoryCaches(queryClient),
		}),
	);

	const unarchiveFolderMutation = useMutation(
		trpc.storyFolder.unarchive.mutationOptions({
			onSuccess: () => invalidateFolderAndStoryCaches(queryClient),
		}),
	);

	function handleArchiveFolder(folder: FolderItem) {
		archiveFolderMutation.mutate({ id: folder.id });
	}

	function handleRestoreFolder(folder: FolderItem) {
		unarchiveFolderMutation.mutate({ id: folder.id });
	}

	const bulkArchiveStoryMutation = useMutation(
		trpc.story.bulkArchive.mutationOptions({
			onSuccess: (_data, variables) => {
				invalidateFolderAndStoryCaches(queryClient);
				deselectStoryIds(variables.items.map((item) => item.storyId));
			},
		}),
	);

	const bulkUnarchiveStoryMutation = useMutation(
		trpc.story.bulkUnarchive.mutationOptions({
			onSuccess: (_data, variables) => {
				invalidateFolderAndStoryCaches(queryClient);
				deselectStoryIds(variables.items.map((item) => item.storyId));
			},
		}),
	);

	const bulkArchiveFolderMutation = useMutation(
		trpc.storyFolder.bulkArchive.mutationOptions({
			onSuccess: (_data, variables) => {
				invalidateFolderAndStoryCaches(queryClient);
				deselectFolderIds(variables.ids);
			},
		}),
	);

	const bulkUnarchiveFolderMutation = useMutation(
		trpc.storyFolder.bulkUnarchive.mutationOptions({
			onSuccess: (_data, variables) => {
				invalidateFolderAndStoryCaches(queryClient);
				deselectFolderIds(variables.ids);
			},
		}),
	);

	function buildBulkStoryItems(): BulkStoryItem[] {
		const storyItems = allItems.filter((item) => selectedStoryIds.has(item.storyId));
		const result: BulkStoryItem[] = [];
		for (const item of storyItems) {
			if (item.kind === 'own' || item.kind === 'own-standalone') {
				result.push({ kind: 'own', storyId: item.storyId });
			} else if (item.kind === 'shared-project') {
				result.push({ kind: 'shared-project', storyId: item.storyId });
			}
		}
		return result;
	}

	function handleBulkArchive() {
		const bulkItems = buildBulkStoryItems();
		const folderIds = [...selectedFolderIds];

		if (bulkItems.length > 0) {
			bulkArchiveStoryMutation.mutate({ items: bulkItems });
		}
		if (folderIds.length > 0) {
			bulkArchiveFolderMutation.mutate({ ids: folderIds });
		}
		if (bulkItems.length === 0 && folderIds.length === 0) {
			clearSelection();
		}
	}

	function handleBulkUnarchive() {
		const bulkItems = buildBulkStoryItems();
		const folderIds = [...selectedFolderIds];

		if (bulkItems.length > 0) {
			bulkUnarchiveStoryMutation.mutate({ items: bulkItems });
		}
		if (folderIds.length > 0) {
			bulkUnarchiveFolderMutation.mutate({ ids: folderIds });
		}
		if (bulkItems.length === 0 && folderIds.length === 0) {
			clearSelection();
		}
	}

	const isBulkPending =
		bulkArchiveStoryMutation.isPending ||
		bulkUnarchiveStoryMutation.isPending ||
		bulkArchiveFolderMutation.isPending ||
		bulkUnarchiveFolderMutation.isPending;

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);

	function handleDragStart(event: DragStartEvent) {
		setActiveId(String(event.active.id));
	}

	function handleDragEnd(event: DragEndEvent) {
		setActiveId(null);
		const { active, over } = event;
		if (!over) {
			return;
		}

		const activeStr = String(active.id);
		const overStr = String(over.id);

		const isStory = activeStr.startsWith('drag-story-');
		const isFolder = activeStr.startsWith('drag-folder-');

		const targetFolderId = parseDropFolderId(overStr);

		if (isStory) {
			const storyId = parseDragStoryId(activeStr);
			moveStoryMutation.mutate({ storyId, folderId: targetFolderId });
		} else if (isFolder) {
			const folderId = parseDragFolderId(activeStr);
			if (targetFolderId === folderId) {
				return;
			}
			moveFolderMutation.mutate({ id: folderId, newParentId: targetFolderId });
		}
	}

	const activeDragItem = useMemo(() => {
		if (!activeId) {
			return null;
		}
		if (activeId.startsWith('drag-story-')) {
			const storyId = parseDragStoryId(activeId);
			return allItems.find((i) => i.storyId === storyId) ?? null;
		}
		if (activeId.startsWith('drag-folder-')) {
			const folderId = parseDragFolderId(activeId);
			return folders.find((f) => f.id === folderId) ?? null;
		}
		return null;
	}, [activeId, allItems, folders]);

	const showExplorerControls = !showArchived;

	return (
		<div className='flex flex-col flex-1 h-full overflow-auto'>
			<MobileHeader />
			<DndContext
				sensors={sensors}
				collisionDetection={pointerWithinFallbackToRect}
				modifiers={[snapCenterToCursor]}
				onDragStart={handleDragStart}
				onDragEnd={handleDragEnd}
				onDragCancel={() => setActiveId(null)}
			>
				<div className='w-full px-4 py-6 md:px-8 md:py-10'>
					<div className='flex items-center justify-between mb-6 md:mb-8 gap-3 flex-wrap'>
						<div className='flex items-center gap-3 min-w-0'>
							<h1 className='text-xl font-semibold tracking-tight shrink-0'>
								<FolderBreadcrumb path={breadcrumbPath} rootIcon={showArchived ? Archive : Home} />
							</h1>
						</div>
						<div className='flex items-center gap-3 min-w-0'>
							{project.data && (
								<ProjectSwitcher
									projects={projects.data ?? []}
									currentProjectId={project.data.id}
									onChange={handleProjectChange}
									variant='inline'
								/>
							)}
							{(!isEmpty || showArchived) && (
								<StoriesToolbarControls
									searchQuery={searchQuery}
									onSearchQueryChange={setSearchQuery}
									displayMode={displayMode}
									onDisplayModeChange={handleDisplayChange}
									showArchived={showArchived}
									onShowArchivedChange={handleShowArchivedChange}
									selectionActive={selectionActive}
									onToggleSelection={toggleSelectionMode}
								/>
							)}
						</div>
					</div>

					{!showArchived && (
						<PromotedSections
							pinned={pinned}
							favorites={promotedFavorites}
							currentUserName={currentUserName}
							onModifyFolder={(folder) => setDialog({ kind: 'modify', folder })}
							onMoveFolder={(folder) => setDialog({ kind: 'picker-folder', folder })}
							onDeleteFolder={(folder) => setDialog({ kind: 'delete', folder })}
							onArchiveFolder={handleArchiveFolder}
							onRestoreFolder={handleRestoreFolder}
							className='mb-6'
							selectedStoryIds={selectedStoryIds}
							selectedFolderIds={selectedFolderIds}
							onToggleStory={toggleStorySelection}
							onToggleFolder={toggleFolderSelection}
							selectionMode={selectionMode}
						/>
					)}

					{!isEmpty && showExplorerControls && (
						<div className='mb-2'>
							<SortHeader value={sort} onChange={handleSortChange} displayMode={displayMode} />
						</div>
					)}

					<StoriesExplorer
						entries={entries}
						displayMode={displayMode}
						showArchived={showArchived}
						searchQuery={searchQuery}
						currentFolderId={currentFolderId ?? null}
						currentUserName={currentUserName}
						onMoveToFolder={(item) => setDialog({ kind: 'picker-story', item })}
						onModifyFolder={(folder) => setDialog({ kind: 'modify', folder })}
						onMoveFolder={(folder) => setDialog({ kind: 'picker-folder', folder })}
						onDeleteFolder={(folder) => setDialog({ kind: 'delete', folder })}
						onArchiveFolder={handleArchiveFolder}
						onRestoreFolder={handleRestoreFolder}
						onNewFolder={() => setDialog({ kind: 'create' })}
						selectedStoryIds={selectedStoryIds}
						selectedFolderIds={selectedFolderIds}
						onToggleStory={toggleStorySelection}
						onToggleFolder={toggleFolderSelection}
						selectionMode={selectionMode}
					/>

					<DragOverlay>{activeDragItem && <DragOverlayCard item={activeDragItem} />}</DragOverlay>
				</div>
			</DndContext>

			<StoriesSelectionBar
				selectedCount={selectedStoryIds.size + selectedFolderIds.size}
				limitReached={selectedStoryIds.size >= BULK_ITEMS_LIMIT || selectedFolderIds.size >= BULK_ITEMS_LIMIT}
				showArchived={showArchived}
				isPending={isBulkPending}
				onArchive={handleBulkArchive}
				onUnarchive={handleBulkUnarchive}
				onCancel={clearSelection}
			/>

			<FolderCreateDialog
				open={dialog?.kind === 'create' || dialog?.kind === 'modify'}
				onOpenChange={(open) => {
					if (!open) {
						setDialog(null);
					}
				}}
				mode={dialog?.kind === 'modify' ? 'modify' : 'create'}
				initialName={dialog?.kind === 'modify' ? dialog.folder.name : undefined}
				folderId={dialog?.kind === 'modify' ? dialog.folder.id : undefined}
				parentId={currentFolderId}
			/>

			{dialog?.kind === 'delete' && (
				<FolderDeleteDialog
					open
					onOpenChange={(open) => {
						if (!open) {
							setDialog(null);
						}
					}}
					folderId={dialog.folder.id}
					folderName={dialog.folder.name}
					parentName={
						dialog.folder.parentId
							? (folders.find((f) => f.id === dialog.folder.parentId)?.name ?? 'parent folder')
							: 'Root'
					}
					hasChildren={
						folders.some((f) => f.parentId === dialog.folder.id) ||
						(folderItems.data ?? []).some((i) => i.folderId === dialog.folder.id)
					}
				/>
			)}

			{dialog?.kind === 'picker-story' && (
				<FolderPickerDialog
					open
					onOpenChange={(open) => {
						if (!open) {
							setDialog(null);
						}
					}}
					target={{ type: 'story', storyId: dialog.item.storyId }}
					isOwner={dialog.item.kind === 'own' || dialog.item.kind === 'own-standalone'}
				/>
			)}

			{dialog?.kind === 'picker-folder' && (
				<FolderPickerDialog
					open
					onOpenChange={(open) => {
						if (!open) {
							setDialog(null);
						}
					}}
					target={{ type: 'folder', folderId: dialog.folder.id, currentVisibility: dialog.folder.visibility }}
					isOwner={dialog.folder.ownerId === session?.user?.id}
				/>
			)}
		</div>
	);
}

function parseDropFolderId(overStr: string): string | null {
	if (overStr === 'drop-folder-root') {
		return null;
	}
	const withoutPrefix = overStr.replace(/^drop-folder-/, '');
	const match = withoutPrefix.match(/^(?:grid-large|grid|lines)-(.+)$/);
	return match ? match[1] : withoutPrefix;
}

function parseDragFolderId(activeStr: string): string {
	const withoutPrefix = activeStr.replace(/^drag-folder-/, '');
	const match = withoutPrefix.match(/^(?:grid-large|grid|lines)-(.+)$/);
	return match ? match[1] : withoutPrefix;
}

function parseDragStoryId(activeStr: string): string {
	const withoutPrefix = activeStr.replace(/^drag-story-/, '');
	const match = withoutPrefix.match(/^(?:pinned|favorites)-(.+)$/);
	return match ? match[1] : withoutPrefix;
}

function DragOverlayCard({ item }: { item: StoryItem | FolderItem }) {
	const isFolder = 'storyCount' in item;
	return (
		<div
			className={cn(
				'flex items-center gap-2 px-3 py-2 rounded-md border bg-background shadow-lg text-sm font-medium',
				'opacity-90 pointer-events-none',
			)}
		>
			{isFolder ? (
				<Folder className='size-4 text-muted-foreground shrink-0' />
			) : (
				<span className='size-4 shrink-0' />
			)}
			<span className='truncate max-w-[200px]'>{isFolder ? item.name : item.title}</span>
		</div>
	);
}
