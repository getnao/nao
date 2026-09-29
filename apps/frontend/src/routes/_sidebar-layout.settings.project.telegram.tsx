import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_sidebar-layout/settings/project/telegram')({
	beforeLoad: () => {
		throw redirect({
			to: '/settings/project/integrations/$integrationId',
			params: { integrationId: 'telegram' },
		});
	},
});
