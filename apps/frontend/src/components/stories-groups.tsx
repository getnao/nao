import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArchiveIcon, ArchiveRestoreIcon, Ellipsis } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DisplayMode, StoryGroup, StoryItem } from '@/lib/stories-page';
import { StoryThumbnail } from '@/components/story-thumbnail';
import StoryIcon from '@/components/ui/story-icon';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatRelativeDate } from '@/lib/time-ago';
import { cn } from '@/lib/utils';
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
		const archivable = items.filter((i) => i.kind === 'own' && i.chatId && i.storyId);
		if (archivable.length === 0) return;
		archiveAllMutation.mutate({
			stories: archivable.map((i) => ({ chatId: i.chatId!, storyId: i.storyId! })),
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

function StoryCard({
	item,
	displayMode,
	showArchived,
}: {
	item: StoryItem;
	displayMode: DisplayMode;
	showArchived: boolean;
}) {
	if (item.kind !== 'own' || !item.chatId || !item.storyId) {
		return (
			<Link {...item.link} className={storyCardClass(displayMode)}>
				<StoryCardContent item={item} displayMode={displayMode} />
			</Link>
		);
	}

	return (
		<Link {...item.link} className={cn(storyCardClass(displayMode), 'relative')}>
			<StoryCardContent item={item} displayMode={displayMode} />
			<StoryActionMenu
				chatId={item.chatId}
				storyId={item.storyId}
				displayMode={displayMode}
				showArchived={showArchived}
			/>
		</Link>
	);
}

function StoryActionMenu({
	chatId,
	storyId,
	displayMode,
	showArchived,
}: {
	chatId: string;
	storyId: string;
	displayMode: DisplayMode;
	showArchived: boolean;
}) {
	const queryClient = useQueryClient();

	const archiveMutation = useMutation(
		trpc.story.archive.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
			},
		}),
	);

	const unarchiveMutation = useMutation(
		trpc.story.unarchive.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.story.listArchived.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
			},
		}),
	);

	const pending = archiveMutation.isPending || unarchiveMutation.isPending;

	function handleSelect() {
		if (showArchived) {
			unarchiveMutation.mutate({ chatId, storyId });
		} else {
			archiveMutation.mutate({ chatId, storyId });
		}
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant='ghost'
					size='icon-xs'
					className={cn(
						'relative z-10',
						displayMode === 'grid' &&
							'absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 bg-background/80 backdrop-blur-sm hover:bg-background',
						displayMode === 'lines' &&
							'ml-1 shrink-0 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100',
					)}
					onClick={(e) => e.preventDefault()}
				>
					<Ellipsis className='size-4' />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent onClick={(e) => e.stopPropagation()}>
				<DropdownMenuGroup>
					<DropdownMenuItem onSelect={handleSelect} disabled={pending}>
						{showArchived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
						{showArchived ? 'Unarchive' : 'Archive'}
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
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
		displayMode === 'grid' && 'group relative aspect-[3/4] rounded-lg border bg-background overflow-hidden',
		displayMode === 'lines' && 'group flex items-center gap-3 rounded-md px-3 py-2 hover:bg-sidebar-accent',
	);
}

function StoryCardContent({ item, displayMode }: { item: StoryItem; displayMode: DisplayMode }) {
	const meta = `${item.author} · ${formatRelativeDate(item.createdAt)}`;

	if (displayMode === 'lines') {
		return (
			<>
				<span className='text-sm font-medium truncate'>{item.title}</span>
				<span className='ml-auto text-xs text-muted-foreground whitespace-nowrap'>{meta}</span>
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
				<span className='block text-[11px] text-muted-foreground mt-0.5 truncate'>{meta}</span>
			</div>
		</>
	);
}
