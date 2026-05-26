import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Activity, ArchiveIcon, ArchiveRestoreIcon, Globe, Pin, Star, Users } from 'lucide-react';
import { useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import type { DisplayMode, StoryGroup, StoryItem } from '@/lib/stories-page';
import { ShareStoryDialog } from '@/components/share-dialog.story';
import { StoryThumbnail } from '@/components/story-thumbnail';
import StoryIcon from '@/components/ui/story-icon';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatRelativeDate } from '@/lib/time-ago';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { trpc } from '@/main';

export function StoriesGroups({
	groups,
	displayMode,
	showArchived,
}: {
	groups: StoryGroup[];
	displayMode: DisplayMode;
	showArchived: boolean;
}) {
	const queryClient = useQueryClient();

	const archiveAllMutation = useMutation(
		trpc.story.archiveMany.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listArchived.queryKey() });
			},
		}),
	);

	function handleArchiveAll(items: StoryItem[]) {
		const archivable = items.filter((i) => i.kind === 'own' && i.chatId && i.storySlug);
		if (archivable.length === 0) {
			return;
		}
		archiveAllMutation.mutate({
			stories: archivable.map((i) => ({ chatId: i.chatId!, storySlug: i.storySlug! })),
		});
	}

	return (
		<>
			{groups.map((group, index) => {
				const showArchiveAll = !showArchived && group.label === 'Older';
				return (
					<StoriesSection
						key={group.label}
						title={group.label}
						className={index < groups.length - 1 ? 'mb-10' : undefined}
						action={
							showArchiveAll ? (
								<Button
									variant='ghost'
									size='sm'
									className='text-muted-foreground gap-1.5'
									onClick={() => handleArchiveAll(group.items)}
									disabled={archiveAllMutation.isPending}
								>
									<ArchiveIcon className='size-3.5' />
									<span className='text-xs'>Archive all</span>
								</Button>
							) : undefined
						}
					>
						<StoriesList displayMode={displayMode}>
							{group.items.map((item) => (
								<StoryCard
									key={item.id}
									item={item}
									displayMode={displayMode}
									showArchived={showArchived}
								/>
							))}
						</StoriesList>
					</StoriesSection>
				);
			})}
		</>
	);
}

export function StoriesNoResults({ query }: { query: string }) {
	return (
		<p className='text-muted-foreground text-sm py-12 text-center'>
			No stories matching &ldquo;{query.trim()}&rdquo;
		</p>
	);
}

export function StoriesEmptyState() {
	return (
		<div className='flex flex-col items-center justify-center py-24 text-center'>
			<StoryIcon className='size-10 text-muted-foreground/40 mb-4' />
			<p className='text-muted-foreground text-sm'>No stories yet.</p>
			<p className='text-muted-foreground/60 text-sm mt-1'>
				Stories will appear here as they are created in your chats.
			</p>
		</div>
	);
}

export function StoryCard({
	item,
	displayMode,
	showArchived,
}: {
	item: StoryItem;
	displayMode: DisplayMode;
	showArchived: boolean;
}) {
	const { isAdmin } = usePermissions();
	const [pinShareDialogOpen, setPinShareDialogOpen] = useState(false);

	const canOpenPinShareDialog =
		isAdmin && !item.sharedStoryId && item.kind === 'own' && !!item.chatId && !!item.storySlug;

	return (
		<>
			<Link {...item.link} className={cn(storyCardClass(displayMode), 'relative')}>
				<StoryCardContent item={item} displayMode={displayMode} />
				<StoryActions
					item={item}
					displayMode={displayMode}
					showArchived={showArchived}
					onRequestPinShare={() => setPinShareDialogOpen(true)}
				/>
			</Link>
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

function StoryActions({
	item,
	displayMode,
	showArchived,
	onRequestPinShare,
}: {
	item: StoryItem;
	displayMode: DisplayMode;
	showArchived: boolean;
	onRequestPinShare: () => void;
}) {
	const containerClass =
		displayMode === 'grid'
			? 'absolute top-1.5 right-1.5 flex items-center gap-0.5 z-10'
			: 'flex items-center gap-0.5 shrink-0 ml-1';

	return (
		<div className={containerClass}>
			<StoryQuickActions item={item} onRequestPinShare={onRequestPinShare} />
			<StoryArchiveButton item={item} showArchived={showArchived} />
		</div>
	);
}

function StoryQuickActions({
	item,
	onRequestPinShare,
}: {
	item: StoryItem;
	onRequestPinShare: () => void;
}) {
	const queryClient = useQueryClient();
	const { isAdmin } = usePermissions();

	const favoriteMutation = useMutation(
		trpc.story.toggleFavorite.mutationOptions({
			onMutate: async ({ storyId }) => {
				const queryKey = trpc.story.listFavorites.queryKey();
				await queryClient.cancelQueries({ queryKey });
				const snapshots = queryClient.getQueriesData<string[]>({ queryKey });
				queryClient.setQueriesData<string[]>({ queryKey }, (old) => {
					if (!old) {
						return item.isFavorited ? [] : [storyId];
					}
					return item.isFavorited ? old.filter((id) => id !== storyId) : [...old, storyId];
				});
				return { snapshots };
			},
			onError: (_err, _vars, context) => {
				for (const [key, data] of context?.snapshots ?? []) {
					queryClient.setQueryData(key, data);
				}
			},
			onSettled: () => {
				queryClient.invalidateQueries({ queryKey: trpc.story.listFavorites.queryKey() });
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
		favoriteMutation.mutate({ storyId: item.storyId });
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
					tooltip={item.isPinned ? 'Unpin for shared members' : 'Pin for shared members'}
				>
					<Pin className='size-3.5' />
				</QuickActionButton>
			)}
			<QuickActionButton
				active={item.isFavorited}
				interactive
				pending={favoriteMutation.isPending}
				onClick={handleFavorite}
				tooltip={item.isFavorited ? 'Remove from favorites' : 'Add to favorites'}
			>
				<Star className='size-3.5' />
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
				'inline-flex items-center justify-center size-6 transition cursor-pointer disabled:cursor-default',
				active
					? 'opacity-100 text-primary [&_svg]:fill-current'
					: 'opacity-0 group-hover:opacity-100 text-muted-foreground',
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

	const archiveChatStory = useMutation(
		trpc.story.archive.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
			},
		}),
	);

	const unarchiveChatStory = useMutation(
		trpc.story.unarchive.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.story.listArchived.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
			},
		}),
	);

	const archiveStandalone = useMutation(
		trpc.story.archiveStandalone.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.story.listStandalone.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listStandaloneArchived.queryKey() });
			},
		}),
	);

	const unarchiveStandalone = useMutation(
		trpc.story.unarchiveStandalone.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.story.listStandalone.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listStandaloneArchived.queryKey() });
			},
		}),
	);

	const canArchive =
		(item.kind === 'own' && item.chatId && item.storySlug) || item.kind === 'own-standalone';

	if (!canArchive) {
		return null;
	}

	const pending =
		archiveChatStory.isPending ||
		unarchiveChatStory.isPending ||
		archiveStandalone.isPending ||
		unarchiveStandalone.isPending;

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
			{showArchived ? <ArchiveRestoreIcon className='size-3.5' /> : <ArchiveIcon className='size-3.5' />}
		</QuickActionButton>
	);
}

function StoriesSection({
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

function StoriesList({ displayMode, children }: { displayMode: DisplayMode; children: ReactNode }) {
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

function storyCardClass(displayMode: DisplayMode) {
	return cn(
		displayMode === 'grid' && 'group relative aspect-[4/3] rounded-lg border bg-background overflow-hidden',
		displayMode === 'lines' && 'group flex items-center gap-3 rounded-md px-3 py-2 hover:bg-sidebar-accent',
	);
}

function StoryCardContent({ item, displayMode }: { item: StoryItem; displayMode: DisplayMode }) {
	const meta = `${item.author} · ${formatRelativeDate(item.createdAt)}`;

	if (displayMode === 'lines') {
		return (
			<>
				<span className='text-sm font-medium truncate'>{item.title}</span>
				<div className='ml-auto flex items-center gap-1.5 shrink-0'>
					<StoryBadges item={item} mode='lines' />
					<span className='text-xs text-muted-foreground whitespace-nowrap'>{meta}</span>
				</div>
			</>
		);
	}

	return (
		<>
			<div className='absolute inset-0 p-3 pb-14'>
				<StoryThumbnail summary={item.summary} />
			</div>
			<div className='absolute inset-x-0 -bottom-2 bg-gradient-to-t from-background from-45% to-transparent px-3 pb-5 pt-8 transition-transform duration-200 ease-out group-hover:-translate-y-1'>
				<span className='text-sm font-medium leading-snug line-clamp-2'>{item.title}</span>
				<div className='flex items-center gap-1.5 mt-0.5'>
					<span className='text-[11px] text-muted-foreground truncate'>{meta}</span>
					<div className='ml-auto'>
						<StoryBadges item={item} mode='grid' />
					</div>
				</div>
			</div>
		</>
	);
}

function StoryBadges({ item, mode }: { item: StoryItem; mode: 'grid' | 'lines' }) {
	const sharingTooltip = item.sharing
		? item.sharing.visibility === 'project'
			? 'Shared with the project'
			: `Shared with ${item.sharing.sharedWithCount} user${item.sharing.sharedWithCount !== 1 ? 's' : ''}`
		: null;

	if (mode === 'grid') {
		if (!item.isLive && !item.sharing) {
			return null;
		}
		return (
			<div className='flex items-center gap-1 shrink-0 mt-0.5'>
				{item.isLive && (
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<span className='inline-flex items-center text-emerald-600 dark:text-emerald-400'>
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
								<span className='inline-flex items-center text-emerald-600 dark:text-emerald-400'>
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
			{item.isLive && (
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger asChild>
							<span className='inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400'>
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
							<span className='inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400'>
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
