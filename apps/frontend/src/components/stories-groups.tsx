import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Activity, ArchiveIcon, ArchiveRestoreIcon, FolderInput, Globe, Lock, Pin, Star, Users } from 'lucide-react';
import { useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import type { StoryPanelDisplayMode } from '@nao/shared/types';

import type { StoryItem } from '@/lib/stories-page';
import { ShareStoryDialog } from '@/components/share-dialog.story';
import { StoryThumbnail } from '@/components/story-thumbnail';
import StoryIcon from '@/components/ui/story-icon';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { usePermissions } from '@/hooks/use-permissions';
import { formatRelativeDate } from '@/lib/time-ago';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export function StoriesNoResults({ query }: { query: string }) {
	return (
		<p className='text-muted-foreground text-sm py-12 text-center'>
			No stories matching &ldquo;{query.trim()}&rdquo;
		</p>
	);
}

export function StoriesEmptyState() {
	const { isViewer } = usePermissions();
	return (
		<div className='flex flex-col items-center justify-center py-24 text-center'>
			<StoryIcon className='size-10 text-muted-foreground/40 mb-4' />
			<p className='text-muted-foreground text-sm'>No stories yet.</p>
			<p className='text-muted-foreground/60 text-sm mt-1'>
				{isViewer
					? 'Wait for someone to share a story with you.'
					: 'Stories will appear here as they are created in your chats.'}
			</p>
		</div>
	);
}

export function StoryCard({
	item,
	displayMode,
	showArchived,
	onMoveToFolder,
	dragIdPrefix,
}: {
	item: StoryItem;
	displayMode: StoryPanelDisplayMode;
	showArchived: boolean;
	onMoveToFolder?: (item: StoryItem) => void;
	dragIdPrefix?: string;
}) {
	const { isAdmin, isViewer } = usePermissions();
	const [pinShareDialogOpen, setPinShareDialogOpen] = useState(false);

	const draggableId = `drag-story-${dragIdPrefix ? `${dragIdPrefix}-` : ''}${item.storyId}`;
	const isOwnedByUser = item.kind === 'own' || item.kind === 'own-standalone';
	const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
		id: draggableId,
		disabled: isViewer,
		data: { type: 'story', isOwnedByUser },
	});
	const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

	const canOpenPinShareDialog =
		isAdmin && !item.sharedStoryId && item.kind === 'own' && !!item.chatId && !!item.storySlug;

	const meta = `${item.author} · ${formatRelativeDate(item.createdAt)}`;

	if (displayMode === 'grid') {
		return (
			<>
				<div
					ref={setNodeRef}
					style={style}
					{...attributes}
					{...listeners}
					className={cn(storyCardClass('grid'), isDragging && 'opacity-0')}
				>
					<div className='absolute inset-0 pointer-events-none overflow-hidden'>
						<StoryThumbnail summary={item.summary} />
					</div>

					<div className='pointer-events-none absolute inset-x-0 bottom-0 h-18 bg-gradient-to-t from-background from-50% to-transparent' />

					<Link
						{...item.link}
						onClick={(e) => e.stopPropagation()}
						className='absolute inset-0 flex flex-col justify-end p-2.5'
					>
						<div className='flex items-end gap-1.5'>
							<div className='flex-1 min-w-0 transition-transform duration-200 ease-out group-hover:-translate-y-0.5'>
								<span className='block text-xs font-medium truncate'>{item.title}</span>
								<span className='block text-[11px] text-muted-foreground truncate'>{meta}</span>
							</div>
							<div className='shrink-0 mb-0.5'>
								<StoryBadges item={item} mode='grid' />
							</div>
						</div>
					</Link>

					<div
						className='absolute top-1.5 left-2 flex items-center z-10'
						onPointerDown={(e) => e.stopPropagation()}
					>
						<StoryQuickActions item={item} onRequestPinShare={() => setPinShareDialogOpen(true)} />
						<div className='flex items-center max-w-0 overflow-hidden group-hover:max-w-[60px] transition-[max-width] duration-200 ease-out'>
							{!showArchived && onMoveToFolder && (
								<StoryMoveToFolderButton item={item} onMoveToFolder={onMoveToFolder} />
							)}
							<StoryArchiveButton item={item} showArchived={showArchived} />
						</div>
					</div>
				</div>
				{canOpenPinShareDialog && item.chatId && item.storySlug && (
					<ShareStoryDialog
						open={pinShareDialogOpen}
						onOpenChange={setPinShareDialogOpen}
						chatId={item.chatId}
						storySlug={item.storySlug}
						intent='pin'
					/>
				)}
			</>
		);
	}

	return (
		<>
			<div
				ref={setNodeRef}
				style={style}
				{...attributes}
				{...listeners}
				className={cn(storyCardClass('lines'), isDragging && 'opacity-0')}
			>
				<Link
					{...item.link}
					onClick={(e) => e.stopPropagation()}
					className='flex items-center gap-3 flex-1 min-w-0'
				>
					<div className='flex items-center gap-2 flex-1 min-w-0 pl-1.5'>
						<span className='text-sm font-medium truncate'>{item.title}</span>
						<div className='flex items-center gap-1.5 shrink-0'>
							<StoryBadges item={item} mode='lines' />
						</div>
					</div>
					<div className='hidden md:block w-32 shrink-0 pl-1.5 text-xs text-muted-foreground truncate'>
						{item.author}
					</div>
					<div className='hidden sm:block w-24 shrink-0 pl-1.5 text-xs text-muted-foreground truncate'>
						{formatRelativeDate(item.createdAt)}
					</div>
				</Link>
				<div className='w-20 shrink-0 flex items-center justify-end'>
					<StoryActions
						item={item}
						showArchived={showArchived}
						onRequestPinShare={() => setPinShareDialogOpen(true)}
						onMoveToFolder={onMoveToFolder}
					/>
				</div>
			</div>
			{canOpenPinShareDialog && item.chatId && item.storySlug && (
				<ShareStoryDialog
					open={pinShareDialogOpen}
					onOpenChange={setPinShareDialogOpen}
					chatId={item.chatId}
					storySlug={item.storySlug}
					intent='pin'
				/>
			)}
		</>
	);
}

export function StoriesSection({
	title,
	className,
	action,
	children,
}: {
	title: string;
	className?: string;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className={className}>
			<div className='flex items-center justify-between mb-4'>
				<h2 className='text-sm font-medium text-muted-foreground'>{title}</h2>
				{action}
			</div>
			{children}
		</section>
	);
}

export function StoriesList({ displayMode, children }: { displayMode: StoryPanelDisplayMode; children: ReactNode }) {
	return (
		<div
			className={cn(
				displayMode === 'grid' &&
					'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3',
				displayMode === 'lines' && 'flex flex-col gap-1',
			)}
		>
			{children}
		</div>
	);
}

function StoryActions({
	item,
	showArchived,
	onRequestPinShare,
	onMoveToFolder,
}: {
	item: StoryItem;
	showArchived: boolean;
	onRequestPinShare: () => void;
	onMoveToFolder?: (item: StoryItem) => void;
}) {
	return (
		<div className='flex items-center' onPointerDown={(e) => e.stopPropagation()}>
			<StoryQuickActions item={item} onRequestPinShare={onRequestPinShare} />
			<div className='flex items-center gap-0.5 max-w-0 overflow-hidden group-hover:max-w-[80px] transition-[max-width] duration-200 ease-out'>
				{!showArchived && onMoveToFolder && (
					<StoryMoveToFolderButton item={item} onMoveToFolder={onMoveToFolder} />
				)}
				<StoryArchiveButton item={item} showArchived={showArchived} />
			</div>
		</div>
	);
}

function StoryMoveToFolderButton({
	item,
	onMoveToFolder,
}: {
	item: StoryItem;
	onMoveToFolder: (item: StoryItem) => void;
}) {
	function handleClick(e: MouseEvent<HTMLButtonElement>) {
		e.preventDefault();
		e.stopPropagation();
		onMoveToFolder(item);
	}

	return (
		<QuickActionButton
			active={false}
			interactive
			pending={false}
			onClick={handleClick}
			tooltip='Move to folder'
			fillOnHover={false}
		>
			<FolderInput className='size-3' />
		</QuickActionButton>
	);
}

function StoryQuickActions({ item, onRequestPinShare }: { item: StoryItem; onRequestPinShare: () => void }) {
	const queryClient = useQueryClient();
	const { isAdmin } = usePermissions();

	const favoriteMutation = useMutation(
		trpc.favorite.toggle.mutationOptions({
			onMutate: async ({ id }) => {
				const queryKey = trpc.favorite.list.queryKey();
				await queryClient.cancelQueries({ queryKey });
				const previous = queryClient.getQueryData(queryKey);
				queryClient.setQueryData(queryKey, (old: typeof previous) => {
					if (!old) {
						return old;
					}
					const storyIds: string[] = old.storyIds ?? [];
					const isFav = storyIds.includes(id);
					return {
						...old,
						storyIds: isFav ? storyIds.filter((sid) => sid !== id) : [...storyIds, id],
					};
				});
				return { previous };
			},
			onError: (_err, _vars, context) => {
				if (context?.previous !== undefined) {
					queryClient.setQueryData(trpc.favorite.list.queryKey(), context.previous);
				}
			},
			onSettled: () => {
				queryClient.invalidateQueries({ queryKey: trpc.favorite.list.queryKey() });
			},
		}),
	);

	const pinMutation = useMutation(
		trpc.storyShare.togglePin.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.storyShare.list.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
			},
		}),
	);

	const canOpenPinShareDialog =
		isAdmin && !item.sharedStoryId && item.kind === 'own' && !!item.chatId && !!item.storySlug;
	const canTogglePin = isAdmin && !!item.sharedStoryId;
	const canInteractWithPin = canTogglePin || canOpenPinShareDialog;
	const showPinSlot = canInteractWithPin || item.isPinned;

	function handleFavorite(e: MouseEvent<HTMLButtonElement>) {
		e.preventDefault();
		e.stopPropagation();
		favoriteMutation.mutate({ type: 'story', id: item.storyId });
	}

	function handlePin(e: MouseEvent<HTMLButtonElement>) {
		e.preventDefault();
		e.stopPropagation();
		if (canTogglePin && item.sharedStoryId) {
			pinMutation.mutate({ sharedStoryId: item.sharedStoryId });
			return;
		}
		if (canOpenPinShareDialog) {
			onRequestPinShare();
		}
	}

	return (
		<>
			{showPinSlot && (
				<QuickActionButton
					active={item.isPinned}
					interactive={canInteractWithPin}
					pending={pinMutation.isPending}
					onClick={handlePin}
					tooltip={
						canInteractWithPin
							? item.isPinned
								? 'Unpin for shared members'
								: 'Pin for shared members'
							: 'Only admins can un.pin stories'
					}
				>
					<Pin className='size-3' />
				</QuickActionButton>
			)}
			<QuickActionButton
				active={item.isFavorited}
				interactive
				pending={favoriteMutation.isPending}
				onClick={handleFavorite}
				tooltip={item.isFavorited ? 'Remove from favorites' : 'Add to favorites'}
			>
				<Star className='size-3' />
			</QuickActionButton>
		</>
	);
}

function QuickActionButton({
	active,
	interactive,
	pending,
	onClick,
	tooltip,
	fillOnHover = true,
	children,
}: {
	active: boolean;
	interactive: boolean;
	pending: boolean;
	onClick: (e: MouseEvent<HTMLButtonElement>) => void;
	tooltip: string;
	fillOnHover?: boolean;
	children: ReactNode;
}) {
	if (!interactive && !active) {
		return null;
	}

	const button = (
		<button
			type='button'
			aria-label={tooltip}
			aria-pressed={active}
			onClick={onClick}
			disabled={pending || !interactive}
			className={cn(
				'inline-flex items-center justify-center h-5 transition-all duration-150 cursor-pointer disabled:cursor-default overflow-hidden',
				active
					? 'w-5 opacity-100 text-primary [&_svg]:fill-current'
					: 'w-0 opacity-0 group-hover:w-5 group-hover:opacity-100 text-muted-foreground',
				interactive && active && 'hover:text-muted-foreground hover:[&_svg]:fill-none',
				interactive && !active && 'hover:text-primary',
				interactive && !active && fillOnHover && 'hover:[&_svg]:fill-current',
			)}
		>
			{children}
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

function StoryArchiveButton({ item, showArchived }: { item: StoryItem; showArchived: boolean }) {
	const queryClient = useQueryClient();
	const { isViewer } = usePermissions();

	function invalidateAfterArchive() {
		queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
		queryClient.invalidateQueries({ queryKey: trpc.story.listArchived.queryKey() });
		queryClient.invalidateQueries({ queryKey: trpc.story.listStandalone.queryKey() });
		queryClient.invalidateQueries({ queryKey: trpc.story.listStandaloneArchived.queryKey() });
		queryClient.invalidateQueries({ queryKey: trpc.story.listSharedArchived.queryKey() });
		queryClient.invalidateQueries({ queryKey: trpc.storyShare.list.queryKey() });
		queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listItems.queryKey() });
		queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listTree.queryKey() });
	}

	const archiveChatStory = useMutation(trpc.story.archive.mutationOptions({ onSuccess: invalidateAfterArchive }));

	const unarchiveChatStory = useMutation(trpc.story.unarchive.mutationOptions({ onSuccess: invalidateAfterArchive }));

	const archiveStandalone = useMutation(
		trpc.story.archiveStandalone.mutationOptions({ onSuccess: invalidateAfterArchive }),
	);

	const unarchiveStandalone = useMutation(
		trpc.story.unarchiveStandalone.mutationOptions({ onSuccess: invalidateAfterArchive }),
	);

	const archiveShared = useMutation(trpc.story.archiveShared.mutationOptions({ onSuccess: invalidateAfterArchive }));

	const unarchiveShared = useMutation(
		trpc.story.unarchiveShared.mutationOptions({ onSuccess: invalidateAfterArchive }),
	);

	const canArchive =
		(item.kind === 'own' && item.chatId && item.storySlug) ||
		item.kind === 'own-standalone' ||
		item.kind === 'shared-project';

	if (!canArchive || isViewer) {
		return null;
	}

	const pending =
		archiveChatStory.isPending ||
		unarchiveChatStory.isPending ||
		archiveStandalone.isPending ||
		unarchiveStandalone.isPending ||
		archiveShared.isPending ||
		unarchiveShared.isPending;

	function handleArchiveToggle(e: MouseEvent<HTMLButtonElement>) {
		e.preventDefault();
		e.stopPropagation();
		if (item.kind === 'own' && item.chatId && item.storySlug) {
			if (showArchived) {
				unarchiveChatStory.mutate({ chatId: item.chatId, storySlug: item.storySlug });
			} else {
				archiveChatStory.mutate({ chatId: item.chatId, storySlug: item.storySlug });
			}
			return;
		}
		if (item.kind === 'own-standalone') {
			if (showArchived) {
				unarchiveStandalone.mutate({ storyId: item.id });
			} else {
				archiveStandalone.mutate({ storyId: item.id });
			}
			return;
		}
		if (item.kind === 'shared-project') {
			if (showArchived) {
				unarchiveShared.mutate({ storyId: item.storyId });
			} else {
				archiveShared.mutate({ storyId: item.storyId });
			}
		}
	}

	return (
		<QuickActionButton
			active={false}
			interactive
			pending={pending}
			onClick={handleArchiveToggle}
			tooltip={showArchived ? 'Unarchive' : 'Archive'}
			fillOnHover={false}
		>
			{showArchived ? <ArchiveRestoreIcon className='size-3' /> : <ArchiveIcon className='size-3' />}
		</QuickActionButton>
	);
}

export function storyCardClass(displayMode: StoryPanelDisplayMode) {
	return cn(
		displayMode === 'grid' && 'group relative h-[120px] rounded-lg border bg-background overflow-hidden',
		displayMode === 'lines' && 'group flex items-center gap-3 rounded-md px-3 py-2 hover:bg-sidebar-accent',
	);
}

function StoryBadges({ item, mode }: { item: StoryItem; mode: 'grid' | 'lines' }) {
	const sharingTooltip = item.sharing
		? item.sharing.visibility === 'project'
			? 'Shared with the project'
			: `Shared with ${item.sharing.sharedWithCount} user${item.sharing.sharedWithCount !== 1 ? 's' : ''}`
		: null;

	if (mode === 'grid') {
		if (!item.isLive && !item.sharing && !item.isInPrivateContext) {
			return null;
		}
		return (
			<div className='flex items-center gap-2 shrink-0'>
				{item.isInPrivateContext && item?.sharing?.visibility !== 'specific' && (
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<span className='inline-flex items-center text-muted-foreground'>
									<Lock className='size-3' />
								</span>
							</TooltipTrigger>
							<TooltipContent>Private story</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				)}
				{item.isLive && (
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<span className='inline-flex items-center text-violet'>
									<Activity className='size-3' />
								</span>
							</TooltipTrigger>
							<TooltipContent>Live story</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				)}
				{item.sharing && (
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<span className='inline-flex items-center text-violet'>
									{item.sharing.visibility === 'project' ? (
										<Globe className='size-3' />
									) : (
										<Users className='size-3' />
									)}
								</span>
							</TooltipTrigger>
							<TooltipContent>{sharingTooltip}</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				)}
			</div>
		);
	}

	return (
		<>
			{item.isInPrivateContext && (
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger asChild>
							<span className='inline-flex items-center text-muted-foreground'>
								<Lock className='size-3' />
							</span>
						</TooltipTrigger>
						<TooltipContent>Private story</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			)}
			{item.isLive && (
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger asChild>
							<span className='inline-flex items-center text-violet'>
								<Activity className='size-3' />
							</span>
						</TooltipTrigger>
						<TooltipContent>Live story</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			)}
			{item.sharing && (
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger asChild>
							<span className='inline-flex items-center text-violet'>
								{item.sharing.visibility === 'project' ? (
									<Globe className='size-3' />
								) : (
									<Users className='size-3' />
								)}
							</span>
						</TooltipTrigger>
						<TooltipContent>{sharingTooltip}</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			)}
		</>
	);
}
