import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_sidebar-layout/settings/')({
	beforeLoad: () => {
		throw redirect({ to: '/settings/general' });
	},
});
