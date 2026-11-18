import { createFileRoute, redirect } from '@tanstack/react-router';

import { StoryRouteError } from '@/components/story-access-error';
import { trpcClient } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/stories/preview/$chatId/$storySlug')({
	beforeLoad: async ({ params }) => {
		const { storyId } = await trpcClient.story.getIdByChatAndSlug.query({
			chatId: params.chatId,
			storySlug: params.storySlug,
		});
		throw redirect({ to: '/stories/$storyId', params: { storyId }, replace: true });
	},
	errorComponent: StoryRouteError,
});
