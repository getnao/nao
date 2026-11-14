import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_sidebar-layout/feed/')({
	beforeLoad: () => {
		throw redirect({ to: '/inbox', replace: true });
	},
});
