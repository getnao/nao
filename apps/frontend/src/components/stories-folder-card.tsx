import { useDndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
	Archive,
	ArchiveRestore,
	Folder,
	FolderInput,
	FolderLock,
	Lock,
	MoreHorizontal,
	Pencil,
	Star,
	Trash2,
} from 'lucide-react';
import type { MouseEvent } from 'react';
import type { StoryPanelDisplayMode } from '@nao/shared/types';
import type { FolderItem } from '@/lib/stories-page';
import { isSystemFolder } from '@/lib/stories-page';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { usePermissions } from '@/hooks/use-permissions';
import { formatRelativeDate } from '@/lib/time-ago';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export type FolderDisplayMode = StoryPanelDisplayMode | 'grid-large';

export function FolderCard({
	folder,
	displayMode,
	currentUserName,
	onModify,
	onMove,
	onDelete,
	onArchive,
	onRestore,
}: {
	folder: FolderItem;
	displayMode: FolderDisplayMode;
	currentUserName: string;
	onModify: (folder: FolderItem) => void;
	onMove: (folder: FolderItem) => void;
	onDelete: (folder: FolderItem) => void;
	onArchive: (folder: FolderItem) => void;
	onRestore: (folder: FolderItem) => void;
}) {
	const { isViewer } = usePermissions();
	const isVirtual = folder.id === '__shared_with_me__';
	const draggableId = `drag-folder-${displayMode}-${folder.id}`;
	const droppableId = `drop-folder-${displayMode}-${folder.id}`;

	const { active } = useDndContext();
	const activeData = active?.data.current as { type?: string; isOwnedByUser?: boolean } | undefined;
	const blockPrivateDrop =
		folder.visibility === 'private' && activeData?.type === 'story' && activeData?.isOwnedByUser === false;

	const {
		attributes,
		listeners,
		setNodeRef: setDragRef,
		transform,
		isDragging,
	} = useDraggable({
		id: draggableId,
		disabled: isVirtual || isSystemFolder(folder) || isViewer,
	});
	const { setNodeRef: setDropRef, isOver } = useDroppable({
		id: droppableId,
		disabled: isVirtual || blockPrivateDrop,
	});

	function setRefs(el: HTMLElement | null) {
		setDragRef(el);
		setDropRef(el);
	}

	const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

	if (displayMode === 'lines') {
		return (
			<div
				ref={setRefs}
				style={style}
				{...attributes}
				{...listeners}
				className={cn(
					'group flex items-center gap-3 rounded-md px-3 py-2 hover:bg-sidebar-accent relative',
					isOver && 'ring-2 ring-primary/50 bg-primary/5',
					isDragging && 'opacity-0',
				)}
			>
				<Link
					to='/stories'
					search={{ folderId: folder.id }}
					className='flex items-center gap-3 flex-1 min-w-0'
					onClick={(e) => e.stopPropagation()}
				>
					<div className='flex items-center gap-2 flex-1 min-w-0 pl-1.5'>
						<FolderIcon folder={folder} />
						<span className='text-sm font-medium truncate'>{folder.name}</span>
					</div>
					<div className='hidden md:block w-32 shrink-0 pl-1.5 text-xs text-muted-foreground truncate'>
						{currentUserName}
					</div>
					<div className='hidden sm:block w-24 shrink-0 pl-1.5 text-xs text-muted-foreground truncate'>
						{formatRelativeDate(folder.updatedAt)}
					</div>
				</Link>
				<div className='w-20 shrink-0 relative h-6'>
					{!isSystemFolder(folder) && (
						<>
							{!isViewer && (
								<div className='absolute top-1/2 right-0 -translate-y-1/2'>
									<FolderKebab
										folder={folder}
										onModify={onModify}
										onMove={onMove}
										onDelete={onDelete}
										onArchive={onArchive}
										onRestore={onRestore}
									/>
								</div>
							)}
							<div
								className={cn(
									'absolute top-1/2 right-0 -translate-y-1/2 z-10 transition-transform duration-150',
									!isViewer &&
										'group-hover:-translate-x-5 group-has-data-[state=open]:-translate-x-5',
								)}
								onPointerDown={(e) => e.stopPropagation()}
							>
								<FolderFavoriteButton folder={folder} />
							</div>
						</>
					)}
				</div>
			</div>
		);
	}

	if (displayMode === 'grid-large') {
		return (
			<div
				ref={setRefs}
				style={style}
				{...attributes}
				{...listeners}
				className={cn(
					'group relative h-[120px] rounded-lg border bg-background overflow-hidden',
					isOver && 'ring-2 ring-primary/50',
					isDragging && 'opacity-0',
				)}
			>
				<div
					className='pointer-events-none absolute'
					style={{ top: 20, left: '38%', width: '27%', height: 38 }}
				>
					<div
						className='absolute inset-0 bg-card rounded-xs ring-1 ring-border shadow-[0_6px_16px_-4px_rgba(0,0,0,0.22)]'
						style={{ transform: 'rotate(-8deg) translate(-6px, -5px)' }}
					/>
					<div
						className='absolute inset-0 bg-card rounded-xs ring-1 ring-border shadow-[0_6px_16px_-4px_rgba(0,0,0,0.22)]'
						style={{ transform: 'rotate(8deg) translate(0px, -5px)' }}
					/>
				</div>

				<div
					className='pointer-events-none absolute text-violet-500'
					style={{ opacity: 1, top: 28, left: '6%', right: '6%', height: 48 }}
				>
					<svg viewBox='0 0 100 62' width='100%' height='100%' overflow='visible'>
						<path
							d='M4 0 L36 0 Q40 0 43 4 L48 10 L96 10 Q100 10 100 14 L100 58 Q100 62 96 62 L4 62 Q0 62 0 58 L0 4 Q0 0 4 0 Z'
							className='fill-background stroke-current'
							strokeWidth='2'
							strokeLinejoin='round'
						/>
					</svg>
				</div>

				<Link
					to='/stories'
					search={{ folderId: folder.id }}
					className='absolute inset-0 flex flex-col justify-end p-2.5'
					onClick={(e) => e.stopPropagation()}
					aria-label={folder.name}
				>
					<div className='flex items-end gap-1.5'>
						<div className='flex-1 min-w-0 items-center gap-1.5 flex-1 min-w-0 transition-transform duration-200 ease-out group-hover:-translate-y-0.5'>
							<span className='block text-xs font-medium truncate'>{folder.name}</span>
							<span className='block text-[11px] text-muted-foreground truncate'>
								{folder.storyCount} {folder.storyCount <= 1 ? 'story' : 'stories'}
							</span>
						</div>
						<div className='flex items-center gap-2 shrink-0 mb-0.5'>
							{folder.visibility === 'private' && (
								<TooltipProvider>
									<Tooltip>
										<TooltipTrigger asChild>
											<span className='inline-flex items-center text-muted-foreground shrink-0'>
												<Lock className='size-3' />
											</span>
										</TooltipTrigger>
										<TooltipContent>Private folder</TooltipContent>
									</Tooltip>
								</TooltipProvider>
							)}
						</div>
					</div>
				</Link>

				{!isSystemFolder(folder) && (
					<>
						<div className='absolute top-1.5 left-2 z-10' onPointerDown={(e) => e.stopPropagation()}>
							<FolderFavoriteButton folder={folder} />
						</div>
						{!isViewer && (
							<div
								className='absolute top-1.5 left-2 z-20 transition-transform duration-150 group-hover:translate-x-5 group-has-data-[state=open]:translate-x-5'
								onPointerDown={(e) => e.stopPropagation()}
							>
								<FolderKebab
									folder={folder}
									onModify={onModify}
									onMove={onMove}
									onDelete={onDelete}
									onArchive={onArchive}
									onRestore={onRestore}
								/>
							</div>
						)}
					</>
				)}
			</div>
		);
	}

	return (
		<div
			ref={setRefs}
			style={style}
			{...attributes}
			{...listeners}
			className={cn(
				'group relative h-10 rounded-md border bg-background overflow-hidden',
				isOver && 'ring-2 ring-primary/50',
				isDragging && 'opacity-0',
			)}
		>
			<Link
				to='/stories'
				search={{ folderId: folder.id }}
				className='absolute inset-0 flex items-center gap-2.5 pl-3 pr-8'
				onClick={(e) => e.stopPropagation()}
			>
				<FolderIcon folder={folder} />
				<span className='text-sm font-medium truncate flex-1 min-w-0'>{folder.name}</span>
			</Link>
			{!isSystemFolder(folder) && (
				<>
					{!isViewer && (
						<div className='absolute top-1/2 right-1.5 -translate-y-1/2 z-10'>
							<FolderKebab
								folder={folder}
								onModify={onModify}
								onMove={onMove}
								onDelete={onDelete}
								onArchive={onArchive}
								onRestore={onRestore}
							/>
						</div>
					)}
					<div
						className={cn(
							'absolute top-1/2 right-1.5 -translate-y-1/2 z-20 transition-transform duration-150',
							!isViewer && 'group-hover:-translate-x-5 group-has-data-[state=open]:-translate-x-5',
						)}
						onPointerDown={(e) => e.stopPropagation()}
					>
						<FolderFavoriteButton folder={folder} />
					</div>
				</>
			)}
		</div>
	);
}

function FolderFavoriteButton({ folder }: { folder: FolderItem }) {
	const queryClient = useQueryClient();

	const toggleFavorite = useMutation(
		trpc.favorite.toggle.mutationOptions({
			onMutate: async () => {
				const queryKey = trpc.favorite.list.queryKey();
				await queryClient.cancelQueries({ queryKey });
				const previous = queryClient.getQueryData(queryKey);
				queryClient.setQueryData(queryKey, (old: typeof previous) => {
					if (!old) {
						return old;
					}
					const folderIds: string[] = old.folderIds ?? [];
					const isFavorited = folderIds.includes(folder.id);
					return {
						...old,
						folderIds: isFavorited ? folderIds.filter((id) => id !== folder.id) : [...folderIds, folder.id],
					};
				});
				return { previous };
			},
			onError: (_err, _vars, ctx) => {
				if (ctx?.previous !== undefined) {
					queryClient.setQueryData(trpc.favorite.list.queryKey(), ctx.previous);
				}
			},
			onSettled: () => {
				queryClient.invalidateQueries({ queryKey: trpc.favorite.list.queryKey() });
			},
		}),
	);

	const favoriteData = queryClient.getQueryData(trpc.favorite.list.queryKey());
	const isFavorited = (favoriteData as { folderIds?: string[] } | undefined)?.folderIds?.includes(folder.id) ?? false;

	function handleClick(e: MouseEvent<HTMLButtonElement>) {
		e.preventDefault();
		e.stopPropagation();
		toggleFavorite.mutate({ type: 'folder', id: folder.id });
	}

	const tooltip = isFavorited ? 'Remove from favorites' : 'Add to favorites';

	const button = (
		<button
			type='button'
			aria-label={tooltip}
			aria-pressed={isFavorited}
			onClick={handleClick}
			disabled={toggleFavorite.isPending}
			className={cn(
				'inline-flex items-center justify-center size-5 transition-all duration-150 cursor-pointer disabled:cursor-default',
				isFavorited
					? 'opacity-100 text-primary [&_svg]:fill-current'
					: 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-has-data-[state=open]:opacity-100 group-has-data-[state=open]:pointer-events-auto text-muted-foreground hover:text-primary hover:[&_svg]:fill-current',
			)}
		>
			<Star className='size-3' />
		</button>
	);

	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>{button}</TooltipTrigger>
				<TooltipContent>{tooltip}</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

function FolderIcon({ folder }: { folder: FolderItem }) {
	if (folder.systemType === 'shared_with_me' || folder.visibility === 'private') {
		return <FolderLock className='size-4 shrink-0 text-muted-foreground' />;
	}
	return <Folder className='size-4 shrink-0 text-muted-foreground' />;
}

function FolderKebab({
	folder,
	onModify,
	onMove,
	onDelete,
	onArchive,
	onRestore,
}: {
	folder: FolderItem;
	onModify: (folder: FolderItem) => void;
	onMove: (folder: FolderItem) => void;
	onDelete: (folder: FolderItem) => void;
	onArchive: (folder: FolderItem) => void;
	onRestore: (folder: FolderItem) => void;
}) {
	const isArchived = folder.archivedAt !== null;

	function stop(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type='button'
					onPointerDown={(e) => e.stopPropagation()}
					onClick={stop}
					aria-label='Folder options'
					className='inline-flex items-center justify-center size-5 rounded transition-opacity duration-150 cursor-pointer opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto data-[state=open]:opacity-100 data-[state=open]:pointer-events-auto'
				>
					<MoreHorizontal className='size-3' />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' onClick={stop}>
				{isArchived ? (
					<DropdownMenuItem onClick={() => onRestore(folder)}>
						<ArchiveRestore />
						Restore folder
					</DropdownMenuItem>
				) : (
					<>
						<DropdownMenuItem onClick={() => onModify(folder)}>
							<Pencil />
							Modify
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => onMove(folder)}>
							<FolderInput />
							Move to…
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => onArchive(folder)}>
							<Archive />
							Archive
						</DropdownMenuItem>
						<DropdownMenuItem variant='destructive' onClick={() => onDelete(folder)}>
							<Trash2 />
							Delete
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
