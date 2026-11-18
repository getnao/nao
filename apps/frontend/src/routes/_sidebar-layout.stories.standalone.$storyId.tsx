import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_sidebar-layout/stories/standalone/$storyId')({
	beforeLoad: ({ params }) => {
		throw redirect({ to: '/stories/$storyId', params: { storyId: params.storyId }, replace: true });
	},
});
