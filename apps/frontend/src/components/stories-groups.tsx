import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { DisplayMode, StoryGroup, StoryItem } from '@/lib/stories-page';
import { StoryThumbnail } from '@/components/story-thumbnail';
import StoryIcon from '@/components/ui/story-icon';
import { formatRelativeDate } from '@/lib/time-ago';
import { cn } from '@/lib/utils';

export function StoriesGroups({ groups, displayMode }: { groups: StoryGroup[]; displayMode: DisplayMode }) {
	return (
		<>
			{groups.map((group, index) => (
				<StoriesSection
					key={group.label}
					title={group.label}
					className={index < groups.length - 1 ? 'mb-10' : undefined}
				>
					<StoriesList displayMode={displayMode}>
						{group.items.map((item) => (
							<Link key={item.id} {...item.link} className={storyCardClass(displayMode)}>
								<StoryCardContent item={item} displayMode={displayMode} />
							</Link>
						))}
					</StoriesList>
				</StoriesSection>
			))}
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

function StoriesSection({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
	return (
		<section className={className}>
			<h2 className='text-sm font-medium text-muted-foreground mb-4'>{title}</h2>
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
		displayMode === 'lines' && 'flex items-center gap-3 rounded-md px-3 py-2 hover:bg-sidebar-accent',
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
