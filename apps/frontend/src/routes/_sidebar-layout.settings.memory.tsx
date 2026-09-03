import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_sidebar-layout/settings/memory')({
	beforeLoad: () => {
		throw redirect({
			to: '/settings/account',
		});
	},
});
