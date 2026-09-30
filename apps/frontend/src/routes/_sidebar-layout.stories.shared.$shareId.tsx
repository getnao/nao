import { createFileRoute, redirect } from '@tanstack/react-router';

import { StoryRouteError } from '@/components/story-access-error';
import { trpcClient } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/stories/shared/$shareId')({
	beforeLoad: async ({ params }) => {
		const { storyId } = await trpcClient.storyShare.getStoryIdByShareId.query({ shareId: params.shareId });
		throw redirect({ to: '/stories/$storyId', params: { storyId }, replace: true });
	},
	errorComponent: StoryRouteError,
});
