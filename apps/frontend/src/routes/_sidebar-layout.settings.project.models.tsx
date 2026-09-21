import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_sidebar-layout/settings/project/models')({
	beforeLoad: () => {
		throw redirect({
			to: '/settings/project/agent',
			search: { tab: 'models' },
		});
	},
});
