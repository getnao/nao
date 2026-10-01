import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { OwnedStoryPage } from '@/components/owned-story-page';
import { SharedStoryPage } from '@/components/shared-story-page';
import { StandaloneStoryPage } from '@/components/standalone-story-page';
import { StoryContentLoading } from '@/components/side-panel/story-content-loading';
import { StoryRouteError } from '@/components/story-access-error';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/stories/$storyId')({
	component: StoryPage,
	pendingComponent: StoryContentLoading,
	errorComponent: StoryRouteError,
});

function StoryPage() {
	const { storyId } = Route.useParams();
	const { data: story } = useSuspenseQuery(trpc.story.resolve.queryOptions({ storyId }));

	if (!story.isOwner) {
		return <SharedStoryPage key={storyId} storyId={storyId} />;
	}

	if (story.chatId) {
		return <OwnedStoryPage key={storyId} chatId={story.chatId} storySlug={story.slug} />;
	}

	return <StandaloneStoryPage key={storyId} storyId={storyId} />;
}
