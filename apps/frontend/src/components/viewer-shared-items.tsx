import { MessageSquare } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { SharedGroup, SharedItem } from '@/lib/viewer-home';
import type { MessageBubble, StoryPanelDisplayMode } from '@nao/shared/types';
import {
	AuthorDateLabel,
	CardsGrid,
	CardsSection,
	GRID_CARD_CLASS,
	GRID_THUMBNAIL_CLASS,
	GridCardFooter,
	LINES_CARD_CLASS,
	LiveBadge,
	SharingBadge,
} from '@/components/item-card';
import { PaperSheet, StoryThumbnail } from '@/components/story-thumbnail';
import StoryIcon from '@/components/ui/story-icon';
import { formatRelativeDate } from '@/lib/time-ago';
import { cn } from '@/lib/utils';

export function ViewerGroups({ groups, displayMode }: { groups: SharedGroup[]; displayMode: StoryPanelDisplayMode }) {
	return (
		<>
			{groups.map((group, index) => (
				<CardsSection
					key={group.label}
					title={group.label}
					className={index < groups.length - 1 ? 'mb-10' : undefined}
				>
					<CardsGrid displayMode={displayMode}>
						{group.items.map((item) =>
							item.kind === 'story' ? (
								<SharedStoryCard key={item.id} item={item} displayMode={displayMode} />
							) : (
								<SharedChatCard key={item.id} item={item} displayMode={displayMode} />
							),
						)}
					</CardsGrid>
				</CardsSection>
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

function SharedStoryCard({ item, displayMode }: { item: SharedItem; displayMode: StoryPanelDisplayMode }) {
	if (displayMode === 'lines') {
		return (
			<Link to='/stories/shared/$shareId' params={{ shareId: item.id }} className={LINES_CARD_CLASS}>
				<SharedItemLine item={item} icon={<StoryIcon className='size-3.5 text-muted-foreground shrink-0' />} />
			</Link>
		);
	}

	return (
		<Link to='/stories/shared/$shareId' params={{ shareId: item.id }} className={GRID_CARD_CLASS}>
			<SharedItemGrid
				item={item}
				thumbnail={<StoryThumbnail summary={item.summary as StoryThumbnailSummary} />}
			/>
		</Link>
	);
}

function SharedChatCard({ item, displayMode }: { item: SharedItem; displayMode: StoryPanelDisplayMode }) {
	if (displayMode === 'lines') {
		return (
			<Link to='/shared-chat/$shareId' params={{ shareId: item.id }} className={LINES_CARD_CLASS}>
				<SharedItemLine
					item={item}
					icon={<MessageSquare className='size-3.5 text-muted-foreground shrink-0' />}
				/>
			</Link>
		);
	}

	return (
		<Link to='/shared-chat/$shareId' params={{ shareId: item.id }} className={GRID_CARD_CLASS}>
			<SharedItemGrid item={item} thumbnail={<ChatThumbnail bubbles={item.messageBubbles} />} />
		</Link>
	);
}

type StoryThumbnailSummary = Parameters<typeof StoryThumbnail>[0]['summary'];

function SharedItemLine({ item, icon }: { item: SharedItem; icon: ReactNode }) {
	return (
		<>
			{icon}
			<span className='text-sm font-medium truncate'>{item.title}</span>
			<SharedItemBadges item={item} />
			<span className='ml-auto text-xs text-muted-foreground whitespace-nowrap'>
				{`${item.authorName} · ${formatRelativeDate(item.createdAt)}`}
			</span>
		</>
	);
}

function SharedItemGrid({ item, thumbnail }: { item: SharedItem; thumbnail: ReactNode }) {
	return (
		<>
			<div className={GRID_THUMBNAIL_CLASS}>{thumbnail}</div>
			<div className='absolute inset-0 flex flex-col justify-end p-2.5'>
				<div className='flex items-end gap-1.5'>
					<GridCardFooter
						title={item.title}
						subtitle={<AuthorDateLabel author={item.authorName} createdAt={item.createdAt} />}
					/>
					<SharedItemBadges item={item} />
				</div>
			</div>
		</>
	);
}

function SharedItemBadges({ item }: { item: SharedItem }) {
	if (!item.isLive && !item.visibility) {
		return null;
	}

	return (
		<div className='flex items-center gap-2 shrink-0'>
			{item.isLive && <LiveBadge />}
			{item.visibility && <SharingBadge visibility={item.visibility} sharedWithCount={item.sharedWithCount} />}
		</div>
	);
}

function ChatThumbnail({ bubbles, className }: { bubbles?: MessageBubble[]; className?: string }) {
	return (
		<PaperSheet className={className}>
			{!bubbles || bubbles.length === 0 ? (
				<div className='flex items-center justify-center pt-[30%]'>
					<MessageSquare className='size-8 text-foreground/20' strokeWidth={1} />
				</div>
			) : (
				<ChatBubbles bubbles={bubbles} />
			)}
		</PaperSheet>
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

const USER_BUBBLE_BORDER = 'border-primary/40';
const USER_BUBBLE_LINE = 'bg-primary/40';
const USER_BUBBLE_LINE_WIDTHS = ['w-full', 'w-4/5', 'w-3/5'];

function UserBubble({ charCount, maxChars }: { charCount: number; maxChars: number }) {
	const ratio = Math.max(charCount / maxChars, 0.15);
	const widthPercent = 35 + ratio * 55;
	const lineCount = Math.max(1, Math.min(Math.round(charCount / 60), 3));

	return (
		<div
			className={cn(
				'self-end shrink-0 flex flex-col gap-[3px] rounded-md border px-[6px] py-[5px]',
				USER_BUBBLE_BORDER,
			)}
			style={{ width: `${Math.round(widthPercent)}%` }}
		>
			{Array.from({ length: lineCount }, (_, i) => (
				<div
					key={i}
					className={cn(
						'h-[1px] rounded-full',
						USER_BUBBLE_LINE,
						USER_BUBBLE_LINE_WIDTHS[i % USER_BUBBLE_LINE_WIDTHS.length],
					)}
				/>
			))}
		</div>
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
						'h-[1px] rounded-full bg-foreground/15',
						ASSISTANT_LINE_WIDTHS[i % ASSISTANT_LINE_WIDTHS.length],
					)}
				/>
			))}
		</div>
	);
}
