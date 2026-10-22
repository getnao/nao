import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { TrpcRouter } from '@nao/backend/trpc';

import { StoryViewer } from '@/components/side-panel/story-viewer';
import { StoryCard } from '@/components/story-card';
import { useSidePanel } from '@/contexts/side-panel';
import { trpc } from '@/main';

type ResolvedStory = inferRouterOutputs<TrpcRouter>['story']['resolve'];

/** An existing story the agent hands over in its answer. */
export function StoryReferenceCard({ storyId, title }: { storyId: string; title: string }) {
	const { data: story, isError } = useResolvedStory(storyId);
	const openStory = useOpenReferencedStory();

	return (
		<StoryCard
			title={story?.title ?? title}
			isCustomStory={story?.format === 'custom'}
			canOpen={Boolean(story)}
			onOpen={() => story && openStory(story)}
			status={<span className='text-xs text-muted-foreground'>{describeStatus(story, isError)}</span>}
		/>
	);
}

/** A story the agent names in the middle of a sentence. */
export function StoryReferenceLink({ storyId, children }: { storyId: string; children: ReactNode }) {
	const { data: story } = useResolvedStory(storyId);
	const openStory = useOpenReferencedStory();

	if (!story) {
		return <>{children}</>;
	}
	return (
		<button
			type='button'
			className='cursor-pointer font-medium text-primary hover:underline'
			onClick={() => openStory(story)}
		>
			{children}
		</button>
	);
}

function describeStatus(story: ResolvedStory | undefined, isError: boolean): string {
	if (isError) {
		return 'Story no longer available';
	}
	return story?.isArchived ? 'Archived story' : 'Existing story';
}

function useResolvedStory(storyId: string) {
	return useQuery({ ...trpc.story.resolve.queryOptions({ storyId }), retry: false });
}

/** The owner opens the story beside the conversation; anyone else opens its page. */
function useOpenReferencedStory() {
	const sidePanel = useSidePanel();
	const navigate = useNavigate();
	const canOpenInSidePanel = Boolean(sidePanel.chatId) && !sidePanel.isReadonlyMode && !sidePanel.isReplay;

	return (story: ResolvedStory) => {
		if (canOpenInSidePanel && story.isOwner && story.chatId) {
			sidePanel.open(<StoryViewer chatId={story.chatId} storySlug={story.slug} />, story.slug);
			return;
		}
		navigate({ to: '/stories/$storyId', params: { storyId: story.storyId } });
	};
}
