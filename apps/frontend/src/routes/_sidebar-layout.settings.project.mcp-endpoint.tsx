import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_sidebar-layout/settings/project/mcp-endpoint')({
	beforeLoad: () => {
		throw redirect({
			to: '/settings/project/integrations',
			search: { tab: 'nao-mcp' },
		});
	},
});
