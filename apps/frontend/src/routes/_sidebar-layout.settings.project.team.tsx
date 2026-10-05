import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_sidebar-layout/settings/project/team')({
	beforeLoad: () => {
		throw redirect({ to: '/settings/project/user-groups', search: { tab: 'users' } });
	},
});
