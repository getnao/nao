import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_sidebar-layout/settings/project/mattermost')({
	beforeLoad: () => {
		throw redirect({
			to: '/settings/project/integrations/$integrationId',
			params: { integrationId: 'mattermost' },
		});
	},
});
