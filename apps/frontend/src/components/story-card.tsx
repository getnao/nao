import { ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import type { StorySummary } from '@nao/shared/types';
import type { StoryTheme } from '@nao/shared/story-theme';
import type { QueryDataMap } from '@/components/story-embeds';

import { CustomStoryThumbnail } from '@/components/custom-story-thumbnail';
import { StoryThumbnail } from '@/components/story-thumbnail';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const EMPTY_SUMMARY: StorySummary = { segments: [] };

interface StoryCardProps {
	title: string;
	status: ReactNode;
	isCustomStory: boolean;
	summary?: StorySummary;
	storyId?: string;
	version?: number;
	theme?: StoryTheme | null;
	queryData?: QueryDataMap | null;
	canOpen: boolean;
	onOpen: () => void;
	actions?: ReactNode;
}

/** The card a story takes in a conversation, opening the story on click. */
export function StoryCard({
	title,
	status,
	isCustomStory,
	summary = EMPTY_SUMMARY,
	storyId,
	version,
	theme,
	queryData,
	canOpen,
	onOpen,
	actions,
}: StoryCardProps) {
	return (
		<div
			className={cn(
				'group @container/story-card my-2 -mx-3 flex items-center rounded-lg border bg-background transition-colors overflow-hidden',
				canOpen ? 'hover:bg-accent/50' : 'opacity-50',
			)}
		>
			<button
				type='button'
				onClick={onOpen}
				disabled={!canOpen}
				className='flex flex-1 min-w-0 items-center gap-3 pr-3 text-left cursor-pointer disabled:cursor-default'
			>
				<div className='items-end relative h-16 w-30 shrink-0'>
					{isCustomStory ? (
						<CustomStoryThumbnail
							storyId={storyId}
							version={version}
							isToolPart={true}
							summary={summary}
							theme={theme}
							queryData={queryData}
						/>
					) : (
						<StoryThumbnail
							summary={summary}
							className='rounded-lg overflow-visible right-6'
							isToolPart={true}
							theme={theme}
							queryData={queryData}
						/>
					)}
				</div>

				<div className='flex flex-col gap-1 min-w-0 flex-1 pl-5 py-3 @max-3xs/story-card:sr-only'>
					<span className='text-sm font-medium truncate'>{title}</span>
					<div className='flex items-center gap-2 overflow-hidden whitespace-nowrap @max-xs/story-card:hidden'>
						{status}
					</div>
				</div>

				{canOpen && (
					<Button variant='ghost-muted' size='icon-xs' className='ml-auto hover:bg-transparent' asChild>
						<span>
							<ArrowUpRight className='size-3.5' />
						</span>
					</Button>
				)}
			</button>

			{actions && <div className='flex shrink-0 items-center pr-3 empty:hidden'>{actions}</div>}
		</div>
	);
}
