import { MessageSquare } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { SharedGroup, SharedItem } from '@/lib/viewer-home';
import type { MessageBubble, StoryPanelDisplayMode } from '@nao/shared/types';
import { StoryThumbnail } from '@/components/story-thumbnail';
import StoryIcon from '@/components/ui/story-icon';
import { formatRelativeDate } from '@/lib/time-ago';
import { cn } from '@/lib/utils';

export function ViewerGroups({ groups, displayMode }: { groups: SharedGroup[]; displayMode: StoryPanelDisplayMode }) {
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

function ViewerItemsList({ displayMode, children }: { displayMode: StoryPanelDisplayMode; children: ReactNode }) {
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

function SharedStoryCard({ item, displayMode }: { item: SharedItem; displayMode: StoryPanelDisplayMode }) {
	const meta = `${item.authorName} · ${formatRelativeDate(item.createdAt)}`;

	if (displayMode === 'lines') {
		return (
			<Link
				to='/stories/shared/$shareId'
				params={{ shareId: item.id }}
				className='group flex items-center gap-3 rounded-md px-3 py-2 hover:bg-sidebar-accent'
			>
				<StoryIcon className='size-3.5 text-muted-foreground shrink-0' />
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
			<div className='absolute inset-0 overflow-hidden'>
				<StoryThumbnail summary={item.summary as Parameters<typeof StoryThumbnail>[0]['summary']} />
			</div>
			<div className='absolute inset-x-0 -bottom-2 bg-gradient-to-t from-background from-45% to-transparent px-3 pb-5 pt-8 transition-transform duration-200 ease-out group-hover:-translate-y-1'>
				<span className='text-sm font-medium leading-snug line-clamp-2'>{item.title}</span>
				<span className='block text-[11px] text-muted-foreground mt-0.5 truncate'>{meta}</span>
			</div>
		</Link>
	);
}

function SharedChatCard({ item, displayMode }: { item: SharedItem; displayMode: StoryPanelDisplayMode }) {
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
			<div className='absolute inset-0 overflow-hidden'>
				<ChatPaperThumbnail bubbles={item.messageBubbles} />
			</div>
			<div className='absolute inset-x-0 -bottom-2 bg-gradient-to-t from-background from-45% to-transparent px-3 pb-5 pt-8 transition-transform duration-200 ease-out group-hover:-translate-y-1'>
				<span className='text-sm font-medium leading-snug line-clamp-2'>{item.title}</span>
				<span className='block text-[11px] text-muted-foreground mt-0.5 truncate'>{meta}</span>
			</div>
		</Link>
	);
}

function ChatPaperThumbnail({ bubbles }: { bubbles?: MessageBubble[] }) {
	return (
		<div className='absolute inset-0 overflow-hidden'>
			<div
				className='absolute top-[20%] left-[8%] w-[90%] h-[200%] origin-top-left bg-card
				           shadow-[0_8px_24px_-8px_rgba(0,0,0,0.18)] ring-1 ring-border rounded-xs'
				style={{ transform: 'perspective(900px) rotateX(12deg) rotateY(-8deg) rotateZ(-20deg)' }}
			>
				<div className='flex flex-col gap-[5px] p-[8%] overflow-hidden'>
					{!bubbles || bubbles.length === 0 ? (
						<div className='flex items-center justify-center pt-[30%]'>
							<MessageSquare className='size-8 text-foreground/20' strokeWidth={1} />
						</div>
					) : (
						<ChatBubbles bubbles={bubbles} />
					)}
				</div>
			</div>
		</div>
	);
}

function ChatBubbles({ bubbles }: { bubbles: MessageBubble[] }) {
	const maxChars = Math.max(...bubbles.map((b) => b.charCount), 1);

	return (
		<>
			{bubbles.map((bubble, i) =>
				bubble.role === 'user' ? (
					<UserBubble key={i} charCount={bubble.charCount} maxChars={maxChars} />
				) : (
					<AssistantResponseLines key={i} charCount={bubble.charCount} />
				),
			)}
		</>
	);
}

function UserBubble({ charCount, maxChars }: { charCount: number; maxChars: number }) {
	const ratio = Math.max(charCount / maxChars, 0.15);
	const widthPercent = 30 + ratio * 65;
	const heightPx = 14 + Math.min(charCount / 80, 5) * 10;

	return (
		<div
			className='self-end rounded-md bg-foreground/12 shrink-0'
			style={{
				width: `${Math.round(widthPercent)}%`,
				height: `${Math.round(heightPx)}px`,
			}}
		/>
	);
}

const ASSISTANT_LINE_WIDTHS = ['w-3/4', 'w-5/6', 'w-2/3', 'w-1/2', 'w-4/5', 'w-3/5'];

function AssistantResponseLines({ charCount }: { charCount: number }) {
	const lineCount = Math.max(2, Math.min(Math.round(charCount / 80), 6));

	return (
		<div className='self-stretch flex flex-col gap-[3px] py-1'>
			{Array.from({ length: lineCount }, (_, i) => (
				<div
					key={i}
					className={cn(
						'h-[3px] rounded-full bg-foreground/15',
						ASSISTANT_LINE_WIDTHS[i % ASSISTANT_LINE_WIDTHS.length],
					)}
				/>
			))}
		</div>
	);
}
