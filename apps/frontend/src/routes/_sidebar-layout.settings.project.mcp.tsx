import { createFileRoute, redirect } from '@tanstack/react-router';
import { requireNonViewer } from '@/lib/require-admin';

export const Route = createFileRoute('/_sidebar-layout/settings/project/mcp')({
	validateSearch: (search: Record<string, unknown>): { tab?: string } => ({
		tab: typeof search.tab === 'string' ? search.tab : undefined,
	}),
	beforeLoad: async ({ search }) => {
		await requireNonViewer();

		if (search.tab === 'servers') {
			throw redirect({
				to: '/settings/project/agent',
				search: { tab: 'mcp-servers' },
			});
		}

		throw redirect({
			to: '/settings/project/integrations',
			search: { tab: 'nao-mcp' },
		});
	},
});
