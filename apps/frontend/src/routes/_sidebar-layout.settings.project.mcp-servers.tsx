import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_sidebar-layout/settings/project/mcp-servers')({
	beforeLoad: () => {
		throw redirect({
			to: '/settings/project/agent',
			search: { tab: 'mcp-servers' },
		});
	},
});
