import { BookOpen, MessageSquare } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { DisplayMode, SharedGroup, SharedItem } from '@/lib/viewer-home';
import type { MessageBubble } from '@nao/shared/types';
import { StoryThumbnail } from '@/components/story-thumbnail';
import StoryIcon from '@/components/ui/story-icon';
import { formatRelativeDate } from '@/lib/time-ago';
import { cn } from '@/lib/utils';

export function ViewerGroups({ groups, displayMode }: { groups: SharedGroup[]; displayMode: DisplayMode }) {
	return (
		<>
			{groups.map((group, index) => (
				<ViewerSection
					key={group.label}
					title={group.label}
					className={index < groups.length - 1 ? 'mb-10' : undefined}
				>
					<ViewerItemsList displayMode={displayMode}>
						{group.items.map((item) =>
							item.kind === 'story' ? (
								<SharedStoryCard key={item.id} item={item} displayMode={displayMode} />
							) : (
								<SharedChatCard key={item.id} item={item} displayMode={displayMode} />
							),
						)}
					</ViewerItemsList>
				</ViewerSection>
			))}
		</>
	);
}

export function ViewerEmptyState() {
	return (
		<div className='flex flex-col items-center justify-center flex-1 py-24 text-center'>
			<StoryIcon className='size-10 text-muted-foreground/40 mb-4' />
			<p className='text-muted-foreground text-sm'>No shared content yet.</p>
			<p className='text-muted-foreground/60 text-sm mt-1'>Stories and chats shared with you will appear here.</p>
		</div>
	);
}

export function ViewerNoResults({ query }: { query: string }) {
	return (
		<p className='text-muted-foreground text-sm py-12 text-center'>
			No results matching &ldquo;{query.trim()}&rdquo;
		</p>
	);
}

function ViewerSection({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
	return (
		<section className={className}>
			<div className='flex items-center justify-between mb-4'>
				<h2 className='text-sm font-medium text-muted-foreground'>{title}</h2>
			</div>
			{children}
		</section>
	);
}

function ViewerItemsList({ displayMode, children }: { displayMode: DisplayMode; children: ReactNode }) {
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

function SharedStoryCard({ item, displayMode }: { item: SharedItem; displayMode: DisplayMode }) {
	const meta = `${item.authorName} · ${formatRelativeDate(item.createdAt)}`;

	if (displayMode === 'lines') {
		return (
			<Link
				to='/stories/shared/$shareId'
				params={{ shareId: item.id }}
				className='group flex items-center gap-3 rounded-md px-3 py-2 hover:bg-sidebar-accent'
			>
				<BookOpen className='size-3.5 text-muted-foreground shrink-0' />
				<span className='text-sm font-medium truncate'>{item.title}</span>
				<span className='ml-auto text-xs text-muted-foreground whitespace-nowrap'>{meta}</span>
			</Link>
		);
	}

	return (
		<Link
			to='/stories/shared/$shareId'
			params={{ shareId: item.id }}
			className='group relative aspect-[3/4] rounded-lg border bg-background overflow-hidden'
		>
			<div className='absolute inset-0 p-3 pb-14'>
				<StoryThumbnail summary={item.summary as Parameters<typeof StoryThumbnail>[0]['summary']} />
			</div>
			<div className='absolute inset-x-0 -bottom-2 bg-gradient-to-t from-background from-45% to-transparent px-3 pb-5 pt-8 transition-transform duration-200 ease-out group-hover:-translate-y-1'>
				<span className='text-sm font-medium leading-snug line-clamp-2'>{item.title}</span>
				<span className='block text-[11px] text-muted-foreground mt-0.5 truncate'>{meta}</span>
			</div>
		</Link>
	);
}

function SharedChatCard({ item, displayMode }: { item: SharedItem; displayMode: DisplayMode }) {
	const meta = `${item.authorName} · ${formatRelativeDate(item.createdAt)}`;

	if (displayMode === 'lines') {
		return (
			<Link
				to='/shared-chat/$shareId'
				params={{ shareId: item.id }}
				className='group flex items-center gap-3 rounded-md px-3 py-2 hover:bg-sidebar-accent'
			>
				<MessageSquare className='size-3.5 text-muted-foreground shrink-0' />
				<span className='text-sm font-medium truncate'>{item.title}</span>
				<span className='ml-auto text-xs text-muted-foreground whitespace-nowrap'>{meta}</span>
			</Link>
		);
	}

	return (
		<Link
			to='/shared-chat/$shareId'
			params={{ shareId: item.id }}
			className='group relative aspect-[3/4] rounded-lg border bg-background overflow-hidden'
		>
			<div className='absolute inset-0 p-3 pb-14'>
				<ChatThumbnail bubbles={item.messageBubbles} />
			</div>
			<div className='absolute inset-x-0 -bottom-2 bg-gradient-to-t from-background from-45% to-transparent px-3 pb-5 pt-8 transition-transform duration-200 ease-out group-hover:-translate-y-1'>
				<span className='text-sm font-medium leading-snug line-clamp-2'>{item.title}</span>
				<span className='block text-[11px] text-muted-foreground mt-0.5 truncate'>{meta}</span>
			</div>
		</Link>
	);
}

function ChatThumbnail({ bubbles }: { bubbles?: MessageBubble[] }) {
	if (!bubbles || bubbles.length === 0) {
		return (
			<div className='flex h-full items-center justify-center text-muted-foreground/20'>
				<MessageSquare className='size-10' strokeWidth={1} />
			</div>
		);
	}

	const maxChars = Math.max(...bubbles.map((b) => b.charCount), 1);

	return (
		<div className='flex flex-col gap-[5px] h-full w-full overflow-hidden'>
			{bubbles.map((bubble, i) => {
				const ratio = Math.max(bubble.charCount / maxChars, 0.15);
				const widthPercent = 30 + ratio * 65;
				const scale = bubble.role === 'user' ? 1 : 1.6;
				const heightPx = (14 + Math.min(bubble.charCount / 80, 5) * 10) * scale;

				return (
					<div
						key={i}
						className={cn(
							'rounded-lg shrink-0',
							bubble.role === 'user'
								? 'self-end bg-primary/[0.08] dark:bg-primary/15'
								: 'self-start bg-muted/70',
						)}
						style={{
							width: `${Math.round(widthPercent)}%`,
							height: `${Math.round(heightPx)}px`,
						}}
					/>
				);
			})}
		</div>
	);
}
