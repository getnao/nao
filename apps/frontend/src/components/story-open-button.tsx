import { useMemo } from 'react';
import { useParams } from '@tanstack/react-router';
import { Button } from './ui/button';
import StoryIcon from './ui/story-icon';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { useSidePanel } from '@/contexts/side-panel';
import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { findStories } from '@/lib/story.utils';

export function StoryOpenButton({ variant = 'outline' }: { variant?: 'outline' | 'ghost' }) {
	const agent = useOptionalAgentContext();
	const { chatId } = useParams({ strict: false });
	const { isVisible, open: openSidePanel } = useSidePanel();
	const stories = useMemo(() => findStories(agent?.messages ?? []), [agent?.messages]);

	if (!agent || stories.length === 0 || isVisible || !chatId) {
		return null;
	}

	const openStory = (storySlug: string) => {
		openSidePanel(<StoryViewer chatId={chatId} storySlug={storySlug} />, storySlug);
	};

	if (stories.length === 1) {
		return (
			<Button
				variant={variant}
				size='icon-sm'
				className='rounded-full hover:rounded-full border w-auto px-2'
				onClick={() => openStory(stories[0].id)}
				title={stories[0].title}
			>
				<StoryIcon className='size-3 text-foreground' strokeWidth={2.25} />
				<span className='text-xs'>Open Story</span>
			</Button>
		);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant={variant}
					size='icon-sm'
					className='rounded-full hover:rounded-full border w-auto px-2'
					title='Open Stories'
				>
					<StoryIcon className='size-3 text-foreground' strokeWidth={2.25} />
					<span className='text-xs'>Open Stories</span>
				</Button>
			</DropdownMenuTrigger>

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
