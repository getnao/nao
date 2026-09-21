import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_sidebar-layout/settings/white-label')({
	beforeLoad: () => {
		throw redirect({
			to: '/settings/appearance',
		});
	},
});
