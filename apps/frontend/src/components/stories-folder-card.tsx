import { useDndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Link } from '@tanstack/react-router';
import {
	Archive,
	ArchiveRestore,
	Circle,
	CircleCheck,
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
import { GRID_CARD_CLASS, GridCardFooter, LINES_CARD_CLASS } from '@/components/item-card';
import { FolderThumbnail } from '@/components/story-thumbnail';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useToggleFavorite } from '@/hooks/use-toggle-favorite';
import { usePermissions } from '@/hooks/use-permissions';
import { useSession } from '@/lib/auth-client';
import { formatRelativeDate } from '@/lib/time-ago';
import { cn } from '@/lib/utils';

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
	selected = false,
	selectionActive = false,
	onToggleSelect,
}: {
	folder: FolderItem;
	displayMode: FolderDisplayMode;
	currentUserName: string;
	onModify: (folder: FolderItem) => void;
	onMove: (folder: FolderItem) => void;
	onDelete: (folder: FolderItem) => void;
	onArchive: (folder: FolderItem) => void;
	onRestore: (folder: FolderItem) => void;
	selected?: boolean;
	selectionActive?: boolean;
	onToggleSelect?: (folderId: string) => void;
}) {
	const { isViewer, isAdmin } = usePermissions();
	const { data: session } = useSession();
	const canManage = isAdmin || folder.ownerId === session?.user?.id;
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
		disabled: isVirtual || isSystemFolder(folder) || isViewer || !canManage || selectionActive,
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
	const canSelect = !isViewer && !isSystemFolder(folder);

	function handleToggleSelect(e: MouseEvent<HTMLElement>) {
		e.preventDefault();
		e.stopPropagation();
		if (canSelect && onToggleSelect) {
			onToggleSelect(folder.id);
		}
	}

	function handleLinkClick(e: MouseEvent<HTMLElement>) {
		if (selectionActive && canSelect) {
			handleToggleSelect(e);
			return;
		}
		e.stopPropagation();
	}

	if (displayMode === 'lines') {
		return (
			<div
				ref={setRefs}
				style={style}
				{...attributes}
				{...listeners}
				className={cn(
					LINES_CARD_CLASS,
					'relative',
					isOver && 'ring-2 ring-primary/50 bg-primary/5',
					isDragging && 'opacity-0',
					selected && 'bg-accent',
				)}
				onClick={selectionActive && canSelect ? handleToggleSelect : undefined}
			>
				<div className='flex items-center flex-1 min-w-0'>
					{canSelect && (
						<div className='shrink-0' onPointerDown={(e) => e.stopPropagation()}>
							<FolderCheckbox
								selected={selected}
								visible={selected || selectionActive}
								onClick={handleToggleSelect}
							/>
						</div>
					)}
					<Link
						to='/stories'
						search={{ folderId: folder.id }}
						className='flex items-center gap-3 flex-1 min-w-0'
						onClick={handleLinkClick}
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
				</div>
				<div className='w-20 shrink-0 relative h-6 overflow-hidden'>
					{!selectionActive && !isSystemFolder(folder) && (
						<>
							{!isViewer && (
								<div className='absolute top-1/2 right-0 -translate-y-1/2'>
									<FolderKebab
										folder={folder}
										canManage={canManage}
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
										canManage &&
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
					GRID_CARD_CLASS,
					isOver && 'ring-2 ring-primary/50',
					isDragging && 'opacity-0',
					selected && 'ring-2 ring-primary',
				)}
				onClick={selectionActive && canSelect ? handleToggleSelect : undefined}
			>
				<div className='absolute top-1 left-1 right-1 bottom-14 overflow-hidden rounded-md bg-sidebar dark:bg-background'>
					<FolderThumbnail />
				</div>

				<Link
					to='/stories'
					search={{ folderId: folder.id }}
					className='absolute inset-0 flex flex-col justify-end p-2.5'
					onClick={handleLinkClick}
					aria-label={folder.name}
				>
					<div className='flex items-end gap-1.5'>
						<GridCardFooter
							title={folder.name}
							subtitle={`${folder.storyCount} ${folder.storyCount <= 1 ? 'story' : 'stories'}`}
						/>
						<div className='flex items-center gap-2 shrink-0 mb-0.5'>
							{folder.visibility === 'private' && (
								<SimpleTooltip content='Private folder'>
									<span className='inline-flex items-center text-muted-foreground shrink-0'>
										<Lock className='size-3' />
									</span>
								</SimpleTooltip>
							)}
						</div>
					</div>
				</Link>

				{!isSystemFolder(folder) && (
					<>
						<div className='absolute top-1.5 left-2 z-10' onPointerDown={(e) => e.stopPropagation()}>
							{canSelect && (
								<FolderCheckbox
									selected={selected}
									visible={selected || selectionActive}
									onClick={handleToggleSelect}
								/>
							)}
							{!selectionActive && <FolderFavoriteButton folder={folder} />}
						</div>
						{!isViewer && !selectionActive && (
							<div
								className='absolute top-1.5 left-2 z-20 transition-transform duration-150 group-hover:translate-x-5 group-has-data-[state=open]:translate-x-5'
								onPointerDown={(e) => e.stopPropagation()}
							>
								<FolderKebab
									folder={folder}
									canManage={canManage}
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

	const contentLeftPadding = !canSelect ? 'pl-3' : selected || selectionActive ? 'pl-9' : 'pl-3 group-hover:pl-9';
	const contentRightPadding = selectionActive ? 'pr-3' : 'pr-8 group-hover:pr-14 group-has-data-[state=open]:pr-14';

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
				selected && 'ring-2 ring-primary',
			)}
			onClick={selectionActive && canSelect ? handleToggleSelect : undefined}
		>
			{selectionActive ? (
				<div
					className={cn(
						'absolute inset-0 flex items-center gap-2.5 transition-[padding] duration-150',
						contentLeftPadding,
						contentRightPadding,
					)}
				>
					<FolderIcon folder={folder} />
					<span className='text-sm font-medium truncate flex-1 min-w-0'>{folder.name}</span>
				</div>
			) : (
				<Link
					to='/stories'
					search={{ folderId: folder.id }}
					className={cn(
						'absolute inset-0 flex items-center gap-2.5 transition-[padding] duration-150',
						contentLeftPadding,
						contentRightPadding,
					)}
					onClick={handleLinkClick}
				>
					<FolderIcon folder={folder} />
					<span className='text-sm font-medium truncate flex-1 min-w-0'>{folder.name}</span>
				</Link>
			)}
			{!isSystemFolder(folder) && (
				<>
					{canSelect && (
						<div
							className='absolute top-1/2 left-2 -translate-y-1/2 z-30'
							onPointerDown={(e) => e.stopPropagation()}
						>
							<FolderCheckbox
								selected={selected}
								visible={selected || selectionActive}
								onClick={handleToggleSelect}
							/>
						</div>
					)}
					{!selectionActive && (
						<>
							{!isViewer && (
								<div className='absolute top-1/2 right-1.5 -translate-y-1/2 z-10'>
									<FolderKebab
										folder={folder}
										canManage={canManage}
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
									!isViewer &&
										'group-hover:-translate-x-5 group-has-data-[state=open]:-translate-x-5',
								)}
								onPointerDown={(e) => e.stopPropagation()}
							>
								<FolderFavoriteButton folder={folder} />
							</div>
						</>
					)}
				</>
			)}
		</div>
	);
}

function FolderCheckbox({
	selected,
	visible,
	onClick,
}: {
	selected: boolean;
	visible: boolean;
	onClick: (e: MouseEvent<HTMLElement>) => void;
}) {
	return (
		<button
			type='button'
			aria-label={selected ? 'Deselect folder' : 'Select folder'}
			aria-pressed={selected}
			onClick={onClick}
			className={cn(
				'inline-flex items-center justify-center size-5 transition-all duration-150 cursor-pointer rounded shrink-0',
				'text-muted-foreground hover:text-foreground',
				visible ? 'opacity-100' : 'w-0 opacity-0 overflow-hidden group-hover:w-5 group-hover:opacity-100',
				selected && 'text-primary',
			)}
		>
			{selected ? <CircleCheck className='size-3' /> : <Circle className='size-3' />}
		</button>
	);
}

function FolderFavoriteButton({ folder }: { folder: FolderItem }) {
	const favorite = useToggleFavorite('folder');
	const isFavorited = favorite.isFavorited(folder.id);
	const tooltip = isFavorited ? 'Remove from favorites' : 'Add to favorites';

	function handleClick(e: MouseEvent<HTMLButtonElement>) {
		e.preventDefault();
		e.stopPropagation();
		favorite.toggle(folder.id);
	}

	return (
		<SimpleTooltip content={tooltip}>
			<button
				type='button'
				aria-label={tooltip}
				aria-pressed={isFavorited}
				onClick={handleClick}
				disabled={favorite.isPending}
				className={cn(
					'inline-flex items-center justify-center size-5 transition-all duration-150 cursor-pointer disabled:cursor-default',
					isFavorited
						? 'opacity-100 text-foreground [&_svg]:fill-current'
						: 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-has-data-[state=open]:opacity-100 group-has-data-[state=open]:pointer-events-auto text-muted-foreground hover:text-foreground hover:[&_svg]:fill-current',
				)}
			>
				<Star className='size-3' />
			</button>
		</SimpleTooltip>
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
	canManage,
	onModify,
	onMove,
	onDelete,
	onArchive,
	onRestore,
}: {
	folder: FolderItem;
	canManage: boolean;
	onModify: (folder: FolderItem) => void;
	onMove: (folder: FolderItem) => void;
	onDelete: (folder: FolderItem) => void;
	onArchive: (folder: FolderItem) => void;
	onRestore: (folder: FolderItem) => void;
}) {
	const isArchived = folder.archivedAt !== null;

	if (!canManage) {
		return null;
	}

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
