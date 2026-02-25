import { useMemo } from 'react';
import { useParams } from '@tanstack/react-router';
import { Button } from './ui/button';
import StoryIcon from './ui/story-icon';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { useSidePanel } from '@/contexts/side-panel';
import { useAgentContext } from '@/contexts/agent.provider';
import { findStories } from '@/lib/story.utils';

export function StoryOpenButton() {
	const { messages } = useAgentContext();
	const { chatId } = useParams({ strict: false });
	const { isVisible, open: openSidePanel } = useSidePanel();
	const stories = useMemo(() => findStories(messages), [messages]);

	if (stories.length === 0 || isVisible || !chatId) {
		return null;
	}

	const openStory = (storyId: string) => {
		openSidePanel(<StoryViewer chatId={chatId} storyId={storyId} />, storyId);
	};

	if (stories.length === 1) {
		return (
			<Button variant='outline' size='icon-md' onClick={() => openStory(stories[0].id)} title={stories[0].title}>
				<StoryIcon className='size-5' strokeWidth={1.5} />
			</Button>
		);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant='outline' size='icon-md' title='Open stories'>
					<StoryIcon className='size-5' strokeWidth={1.5} />
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
