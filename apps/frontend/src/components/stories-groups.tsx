import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import {
	ArchiveIcon,
	ArchiveRestoreIcon,
	Circle,
	CircleCheck,
	FolderInput,
	MoreHorizontal,
	Pin,
	ShieldCheck,
	Star,
} from 'lucide-react';
import { useRef } from 'react';
import type { DragEvent, MouseEvent, ReactNode } from 'react';
import type { StoryPanelDisplayMode } from '@nao/shared/types';

import type { StoryItem } from '@/lib/stories-page';
import { invalidateStoryArchiveCaches, invalidateStoryPlacementCaches } from '@/lib/stories-cache';
import {
	AuthorDateLabel,
	CertifiedBadge,
	GRID_CARD_CLASS,
	GRID_HOVER_ACTION_GRADIENT_CLASS,
	GRID_THUMBNAIL_CLASS,
	GridCardFooter,
	LINES_CARD_CLASS,
	LiveBadge,
	PrivateBadge,
	SharingBadge,
} from '@/components/item-card';
import { CustomStoryThumbnail } from '@/components/custom-story-thumbnail';
import { StoryThumbnail } from '@/components/story-thumbnail';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import StoryIcon from '@/components/ui/story-icon';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useToggleFavorite } from '@/hooks/use-toggle-favorite';
import { useToggleStoryCertification } from '@/hooks/use-toggle-story-certification';
import { useActiveStoryTheme } from '@/hooks/use-active-story-theme';
import { useChatActivity } from '@/hooks/use-chat-activity';
import { usePermissions } from '@/hooks/use-permissions';
import { hasAnyStoryReference, setStoryDragData } from '@/lib/story-reference';
import { selectedStoryReferencesStore } from '@/stores/story-references';
import { formatRelativeDate } from '@/lib/time-ago';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

const VIEW_COUNT_FORMAT = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

export function StoriesNoResults({ query }: { query: string }) {
	return (
		<p className='text-muted-foreground text-sm py-12 text-center'>
			{query.trim() ? <>No stories matching &ldquo;{query.trim()}&rdquo;</> : 'No stories match these filters'}
		</p>
	);
}

export function CertifiedStoriesEmptyState() {
	const { isAdmin } = usePermissions();
	return (
		<div className='flex flex-col items-center justify-center py-24 text-center'>
			<ShieldCheck className='size-10 text-muted-foreground/40 mb-4' />
			<p className='text-muted-foreground text-sm'>No certified stories yet.</p>
			<p className='text-muted-foreground/60 text-sm mt-1'>
				{isAdmin
					? 'Certify a story from its card to highlight it as a trusted source.'
					: 'Admins can certify stories to mark them as trusted sources.'}
			</p>
		</div>
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
	selected = false,
	selectionActive = false,
	onToggleSelect,
}: {
	item: StoryItem;
	displayMode: StoryPanelDisplayMode;
	showArchived: boolean;
	onMoveToFolder?: (item: StoryItem) => void;
	dragIdPrefix?: string;
	selected?: boolean;
	selectionActive?: boolean;
	onToggleSelect?: (storyId: string) => void;
}) {
	const { role, isAdmin, isViewer } = usePermissions();
	const isHomePage = useRouterState({ select: (s) => s.location.pathname === '/' });
	const storyTheme = useActiveStoryTheme();
	const { running: isAgentEditingStory } = useChatActivity(item.chatId ?? '');

	const draggableId = `drag-story-${dragIdPrefix ? `${dragIdPrefix}-` : ''}${item.storyId}`;
	const isOwnedByUser = item.kind === 'own' || item.kind === 'own-standalone';
	const canMove = (isOwnedByUser || isAdmin) && !isAgentEditingStory;
	const isMoveDragDisabled = isViewer || !canMove || (selectionActive && !selected);
	const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
		id: draggableId,
		disabled: isMoveDragDisabled,
		data: { type: 'story', isOwnedByUser },
	});
	const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
	const moveHandler = canMove ? onMoveToFolder : undefined;

	const canSelect =
		!!role &&
		!isViewer &&
		!isHomePage &&
		((item.kind === 'own' && !!item.chatId && !!item.storySlug) ||
			item.kind === 'own-standalone' ||
			item.kind === 'shared-project');

	function handleCardClick(e: MouseEvent<HTMLDivElement>) {
		if (!canSelect || !onToggleSelect) {
			return;
		}
		if (e.metaKey || e.ctrlKey || selectionActive) {
			e.preventDefault();
			onToggleSelect(item.storyId);
		}
	}

	function handleCheckboxClick(e: MouseEvent<HTMLButtonElement>) {
		e.preventDefault();
		e.stopPropagation();
		if (canSelect && onToggleSelect) {
			onToggleSelect(item.storyId);
		}
	}

	function handleNativeDragStart(e: DragEvent<HTMLDivElement>) {
		if (showArchived) {
			e.preventDefault();
			return;
		}
		const selection = selectedStoryReferencesStore.getSnapshot();
		setStoryDragData(
			e,
			selected && hasAnyStoryReference(selection) ? selection : { storyIds: [item.storyId], folderIds: [] },
		);
	}

	function handleLinkClick(e: MouseEvent<HTMLAnchorElement>) {
		if (canSelect && onToggleSelect && (e.metaKey || e.ctrlKey || selectionActive)) {
			e.preventDefault();
			e.stopPropagation();
			onToggleSelect(item.storyId);
			return;
		}
		e.stopPropagation();
	}

	if (displayMode === 'grid') {
		const certifiedBadge = item.isCertified && (
			<div className='absolute top-1.5 right-2 flex h-5 items-center'>
				<CertifiedBadge certifiedByName={item.certifiedByName} />
			</div>
		);
		const hasPersistentTopIcons = item.isCertified || (!selectionActive && (item.isPinned || item.isFavorited));

		return (
			<>
				<div
					ref={setNodeRef}
					style={style}
					{...attributes}
					{...listeners}
					className={cn(GRID_CARD_CLASS, isDragging && 'opacity-0', selected && 'ring-2 ring-primary')}
					onClick={handleCardClick}
					draggable={selectionActive && isMoveDragDisabled}
					onDragStart={handleNativeDragStart}
				>
					<div className={GRID_THUMBNAIL_CLASS}>
						{item.format === 'custom' ? (
							<CustomStoryThumbnail
								storyId={item.storyId}
								version={item.version}
								summary={item.summary}
								theme={storyTheme}
								queryData={item.kpiPreviewData}
							/>
						) : (
							<StoryThumbnail summary={item.summary} theme={storyTheme} queryData={item.kpiPreviewData} />
						)}
					</div>
					<div className={cn(GRID_HOVER_ACTION_GRADIENT_CLASS, hasPersistentTopIcons && 'opacity-100')} />

					{!selectionActive && (
						<Link
							{...item.link}
							onClick={handleLinkClick}
							className='absolute inset-0 z-[2] flex flex-col justify-end p-2.5'
						>
							{certifiedBadge}
							<div className='flex items-end gap-1.5'>
								<GridCardFooter
									title={item.title}
									subtitle={<AuthorDateLabel author={item.author} createdAt={item.createdAt} />}
								/>
								<div className='shrink-0'>
									<StoryBadges item={item} mode='grid' />
								</div>
							</div>
						</Link>
					)}

					{selectionActive && (
						<div className='absolute inset-0 flex flex-col justify-end p-2.5 pointer-events-none'>
							{certifiedBadge}
							<div className='flex items-end gap-1.5'>
								<GridCardFooter
									title={item.title}
									subtitle={<AuthorDateLabel author={item.author} createdAt={item.createdAt} />}
								/>
								<div className='shrink-0'>
									<StoryBadges item={item} mode='grid' />
								</div>
							</div>
						</div>
					)}

					<div
						className='absolute top-1.5 left-2 flex items-center z-10'
						onPointerDown={(e) => e.stopPropagation()}
					>
						{canSelect && (
							<StoryCheckbox
								selected={selected}
								visible={selected || selectionActive}
								onClick={handleCheckboxClick}
							/>
						)}
						{!selectionActive && (
							<StoryGridActions item={item} showArchived={showArchived} onMoveToFolder={moveHandler} />
						)}
					</div>
				</div>
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
				className={cn(LINES_CARD_CLASS, isDragging && 'opacity-0', selected && 'bg-accent')}
				onClick={handleCardClick}
				onDragStart={handleNativeDragStart}
			>
				<div className='flex items-center flex-1 min-w-0'>
					{canSelect && (
						<div className='shrink-0' onPointerDown={(e) => e.stopPropagation()}>
							<StoryCheckbox
								selected={selected}
								visible={selected || selectionActive}
								onClick={handleCheckboxClick}
							/>
						</div>
					)}
					<Link {...item.link} onClick={handleLinkClick} className='flex items-center gap-3 flex-1 min-w-0'>
						<div className='flex items-center gap-2 flex-1 min-w-0 pl-1.5'>
							<span className='text-sm font-medium truncate'>{item.title}</span>
							<div className='flex items-center gap-1.5 shrink-0'>
								<StoryBadges item={item} mode='lines' />
							</div>
						</div>
						<div className='hidden md:block w-32 shrink-0 pl-1.5 text-xs text-muted-foreground truncate'>
							{item.author}
						</div>
						<div className='hidden lg:block w-16 shrink-0 pl-1.5 text-xs text-muted-foreground tabular-nums truncate'>
							{item.viewCount === null ? '—' : VIEW_COUNT_FORMAT.format(item.viewCount)}
						</div>
						<div className='hidden sm:block w-24 shrink-0 pl-1.5 text-xs text-muted-foreground truncate'>
							{formatRelativeDate(item.createdAt)}
						</div>
					</Link>
				</div>
				<div
					className='w-26 shrink-0 flex items-center justify-end overflow-hidden'
					onPointerDown={(e) => e.stopPropagation()}
				>
					{!selectionActive && (
						<StoryActions item={item} showArchived={showArchived} onMoveToFolder={moveHandler} />
					)}
				</div>
			</div>
		</>
	);
}

function StoryCheckbox({
	selected,
	visible,
	onClick,
}: {
	selected: boolean;
	visible: boolean;
	onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
	return (
		<button
			type='button'
			aria-label={selected ? 'Deselect story' : 'Select story'}
			aria-pressed={selected}
			onClick={onClick}
			className={cn(
				'inline-flex items-center justify-center size-5 transition-all duration-150 cursor-pointer rounded shrink-0',
				'text-muted-foreground hover:text-foreground',
				visible
					? 'w-5 opacity-100'
					: 'w-0 opacity-0 overflow-hidden group-hover:w-5 group-hover:opacity-100 group-has-data-[state=open]:w-5 group-has-data-[state=open]:opacity-100',
				selected && 'text-primary',
			)}
		>
			{selected ? <CircleCheck className='size-3' /> : <Circle className='size-3' />}
		</button>
	);
}

function StoryGridActions({
	item,
	showArchived,
	onMoveToFolder,
}: {
	item: StoryItem;
	showArchived: boolean;
	onMoveToFolder?: (item: StoryItem) => void;
}) {
	const pin = useStoryPinToggle(item);

	return (
		<>
			{item.isPinned && <StoryPinButton item={item} pin={pin} />}
			{item.isFavorited && <StoryFavoriteButton item={item} />}
			<StoryActionsMenu item={item} pin={pin} showArchived={showArchived} onMoveToFolder={onMoveToFolder} />
		</>
	);
}

function StoryActionsMenu({
	item,
	pin,
	showArchived,
	onMoveToFolder,
}: {
	item: StoryItem;
	pin: StoryPinToggle;
	showArchived: boolean;
	onMoveToFolder?: (item: StoryItem) => void;
}) {
	const { isAdmin } = usePermissions();
	const favorite = useToggleFavorite('story');
	const certification = useToggleStoryCertification();
	const archive = useStoryArchiveToggle(item, showArchived);
	const openedWithPointer = useRef(false);

	function stop(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
	}

	function skipFocusReturnAfterPointerOpen(e: Event) {
		if (openedWithPointer.current) {
			e.preventDefault();
		}
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type='button'
					onPointerDown={() => {
						openedWithPointer.current = true;
					}}
					onKeyDown={() => {
						openedWithPointer.current = false;
					}}
					onClick={stop}
					aria-label='Story options'
					className='inline-flex items-center justify-center h-5 rounded overflow-hidden transition-all duration-150 cursor-pointer text-muted-foreground hover:text-foreground w-0 opacity-0 group-hover:w-5 group-hover:opacity-100 data-[state=open]:w-5 data-[state=open]:opacity-100 data-[state=open]:text-foreground'
				>
					<MoreHorizontal className='size-3' />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='start' onClick={stop} onCloseAutoFocus={skipFocusReturnAfterPointerOpen}>
				{isAdmin && (
					<DropdownMenuItem
						onSelect={() => certification.toggle(item.storyId)}
						disabled={certification.isPending}
						title={
							item.isCertified && item.certifiedByName
								? `Certified by ${item.certifiedByName}`
								: undefined
						}
					>
						<ShieldCheck />
						{item.isCertified ? 'Remove certification' : 'Certify'}
					</DropdownMenuItem>
				)}
				{pin.canToggle && (
					<DropdownMenuItem onSelect={pin.toggle} disabled={pin.isPending}>
						<Pin />
						{pin.label}
					</DropdownMenuItem>
				)}
				<DropdownMenuItem onSelect={() => favorite.toggle(item.storyId)} disabled={favorite.isPending}>
					<Star />
					{item.isFavorited ? 'Remove from favorites' : 'Add to favorites'}
				</DropdownMenuItem>
				{!showArchived && onMoveToFolder && (
					<DropdownMenuItem onSelect={() => onMoveToFolder(item)}>
						<FolderInput />
						Move to folder
					</DropdownMenuItem>
				)}
				{archive.canToggle && (
					<DropdownMenuItem onSelect={archive.toggle} disabled={archive.isPending}>
						{showArchived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
						{showArchived ? 'Unarchive' : 'Archive'}
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function StoryActions({
	item,
	showArchived,
	onMoveToFolder,
}: {
	item: StoryItem;
	showArchived: boolean;
	onMoveToFolder?: (item: StoryItem) => void;
}) {
	const { isAdmin } = usePermissions();
	const certification = useToggleStoryCertification();
	const pin = useStoryPinToggle(item);
	const archive = useStoryArchiveToggle(item, showArchived);

	return (
		<div className='flex items-center'>
			{isAdmin && (
				<QuickActionButton
					active={item.isCertified}
					interactive
					pending={certification.isPending}
					onClick={() => certification.toggle(item.storyId)}
					tooltip={
						item.isCertified
							? `Remove certification${item.certifiedByName ? ` (by ${item.certifiedByName})` : ''}`
							: 'Certify story'
					}
				>
					<ShieldCheck className='size-3' />
				</QuickActionButton>
			)}
			<StoryPinButton item={item} pin={pin} />
			<StoryFavoriteButton item={item} />
			<div className='flex items-center gap-0.5 max-w-0 overflow-hidden group-hover:max-w-[60px] transition-[max-width] duration-200 ease-out'>
				{!showArchived && onMoveToFolder && (
					<QuickActionButton
						active={false}
						interactive
						pending={false}
						onClick={() => onMoveToFolder(item)}
						tooltip='Move to folder'
						fillOnHover={false}
					>
						<FolderInput className='size-3' />
					</QuickActionButton>
				)}
				{archive.canToggle && (
					<QuickActionButton
						active={false}
						interactive
						pending={archive.isPending}
						onClick={archive.toggle}
						tooltip={showArchived ? 'Unarchive' : 'Archive'}
						fillOnHover={false}
					>
						{showArchived ? <ArchiveRestoreIcon className='size-3' /> : <ArchiveIcon className='size-3' />}
					</QuickActionButton>
				)}
			</div>
		</div>
	);
}

function StoryPinButton({ item, pin }: { item: StoryItem; pin: StoryPinToggle }) {
	return (
		<QuickActionButton
			active={item.isPinned}
			interactive={pin.canToggle}
			pending={pin.isPending}
			onClick={pin.toggle}
			tooltip={pin.canToggle ? pin.label : 'Only admins can un.pin stories'}
		>
			<Pin className='size-3' />
		</QuickActionButton>
	);
}

function StoryFavoriteButton({ item }: { item: StoryItem }) {
	const favorite = useToggleFavorite('story');

	return (
		<QuickActionButton
			active={item.isFavorited}
			interactive
			pending={favorite.isPending}
			onClick={() => favorite.toggle(item.storyId)}
			tooltip={item.isFavorited ? 'Remove from favorites' : 'Add to favorites'}
		>
			<Star className='size-3' />
		</QuickActionButton>
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
	onClick: () => void;
	tooltip: string;
	fillOnHover?: boolean;
	children: ReactNode;
}) {
	if (!interactive && !active) {
		return null;
	}

	function handleClick(e: MouseEvent<HTMLButtonElement>) {
		e.preventDefault();
		e.stopPropagation();
		onClick();
	}

	return (
		<SimpleTooltip content={tooltip}>
			<button
				type='button'
				aria-label={tooltip}
				aria-pressed={active}
				onClick={handleClick}
				disabled={pending || !interactive}
				className={cn(
					'inline-flex items-center justify-center h-5 transition-all duration-150 cursor-pointer disabled:cursor-default overflow-hidden',
					active
						? 'w-5 opacity-100 text-foreground [&_svg]:fill-current'
						: 'w-0 opacity-0 group-hover:w-5 group-hover:opacity-100 text-muted-foreground',
					interactive && active && 'hover:text-muted-foreground hover:[&_svg]:fill-none',
					interactive && !active && 'hover:text-foreground',
					interactive && !active && fillOnHover && 'hover:[&_svg]:fill-current',
				)}
			>
				{children}
			</button>
		</SimpleTooltip>
	);
}

type StoryPinToggle = ReturnType<typeof useStoryPinToggle>;

function useStoryPinToggle(item: StoryItem) {
	const queryClient = useQueryClient();
	const { isAdmin } = usePermissions();
	const pinMutation = useMutation(
		trpc.storyShare.togglePin.mutationOptions({
			onSuccess: () => {
				invalidateStoryPlacementCaches(queryClient);
				void queryClient.invalidateQueries({ queryKey: trpc.storyShare.getShareSettings.queryKey() });
			},
		}),
	);

	const canPinUnshared = isAdmin && !item.isShared && item.kind === 'own';
	const label = item.isPinned
		? 'Unpin for shared members'
		: canPinUnshared
			? 'Pin for the whole project'
			: 'Pin for shared members';

	return {
		canToggle: (isAdmin && item.isShared) || canPinUnshared,
		label,
		isPending: pinMutation.isPending,
		toggle: () => pinMutation.mutate({ storyId: item.storyId }),
	};
}

function useStoryArchiveToggle(item: StoryItem, showArchived: boolean) {
	const queryClient = useQueryClient();
	const { isViewer, isAdmin } = usePermissions();

	function invalidateAfterArchive() {
		invalidateStoryArchiveCaches(queryClient);
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
		(item.kind === 'own' && !!item.chatId && !!item.storySlug) ||
		item.kind === 'own-standalone' ||
		(item.kind === 'shared-project' && isAdmin);

	const isPending =
		archiveChatStory.isPending ||
		unarchiveChatStory.isPending ||
		archiveStandalone.isPending ||
		unarchiveStandalone.isPending ||
		archiveShared.isPending ||
		unarchiveShared.isPending;

	function toggle() {
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
				unarchiveStandalone.mutate({ storyId: item.storyId });
			} else {
				archiveStandalone.mutate({ storyId: item.storyId });
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

	return { canToggle: canArchive && !isViewer, isPending, toggle };
}

function StoryBadges({ item, mode }: { item: StoryItem; mode: 'grid' | 'lines' }) {
	const certified = item.isCertified ? <CertifiedBadge certifiedByName={item.certifiedByName} /> : null;
	const live = item.isLive ? <LiveBadge iconOnly={mode === 'grid'} /> : null;
	const sharing =
		item.sharing?.visibility === 'specific' ? (
			<SharingBadge
				visibility={item.sharing.visibility}
				sharedWithCount={item.sharing.sharedWithCount}
				sharedWithGroupCount={item.sharing.sharedWithGroupCount}
			/>
		) : null;

	if (mode === 'grid') {
		if (!live && !sharing) {
			return null;
		}
		return (
			<div className='flex items-center gap-2 shrink-0'>
				{live}
				{sharing}
			</div>
		);
	}

	return (
		<>
			{certified}
			{item.isInPrivateContext && <PrivateBadge />}
			{live}
			{sharing}
		</>
	);
}
