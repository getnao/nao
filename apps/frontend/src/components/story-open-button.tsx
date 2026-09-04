import { useParams } from '@tanstack/react-router';
import { Button } from './ui/button';
import StoryIcon from './ui/story-icon';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import type { StorySummary } from '@/lib/story.utils';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { useSidePanel } from '@/contexts/side-panel';
import { useAgentMessagesSelector, useOptionalAgentContext } from '@/contexts/agent.provider';
import { getShortcutLabel } from '@/lib/keyboard-shortcuts';
import { findStories } from '@/lib/story.utils';

export function StoryOpenButton({ variant = 'outline' }: { variant?: 'outline' | 'ghost' }) {
	const agent = useOptionalAgentContext();
	const { chatId } = useParams({ strict: false });
	const { isVisible, open: openSidePanel } = useSidePanel();
	const stories = useAgentMessagesSelector(findStories, areStoriesEqual);

	if (!agent || stories.length === 0 || isVisible || !chatId) {
		return null;
	}

	const openStory = (storySlug: string) => {
		openSidePanel(<StoryViewer chatId={chatId} storySlug={storySlug} />, storySlug);
	};

	if (stories.length === 1) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant={variant}
						size='icon-sm'
						className='rounded-full hover:rounded-full border w-auto px-2'
						onClick={() => openStory(stories[0].id)}
					>
						<StoryIcon className='size-3 text-foreground' strokeWidth={2.25} />
						<span className='text-xs'>Open Story</span>
					</Button>
				</TooltipTrigger>
				<StoryShortcutTooltip label='Open Story' />
			</Tooltip>
		);
	}

	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button
							variant={variant}
							size='icon-sm'
							className='rounded-full hover:rounded-full border w-auto px-2'
						>
							<StoryIcon className='size-3 text-foreground' strokeWidth={2.25} />
							<span className='text-xs'>Open Stories</span>
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<StoryShortcutTooltip label='Open Stories' />
			</Tooltip>

			<DropdownMenuContent align='end'>
				{stories.map((story) => (
					<DropdownMenuItem key={story.id} onClick={() => openStory(story.id)}>
						<span className='truncate'>{story.title}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function StoryShortcutTooltip({ label }: { label: string }) {
	return (
		<TooltipContent>
			<span className='flex items-center gap-2'>
				{label}
				<kbd className='text-[10px] opacity-60 font-sans'>{getShortcutLabel('toggle-story-chat')}</kbd>
			</span>
		</TooltipContent>
	);
}

function areStoriesEqual(left: StorySummary[], right: StorySummary[]): boolean {
	return (
		left.length === right.length &&
		left.every((story, index) => story.id === right[index]?.id && story.title === right[index]?.title)
	);
}
