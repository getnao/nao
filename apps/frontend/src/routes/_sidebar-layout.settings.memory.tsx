import { createFileRoute, redirect } from '@tanstack/react-router';
import { requireNonViewer } from '@/lib/require-admin';

export const Route = createFileRoute('/_sidebar-layout/settings/memory')({
	beforeLoad: async () => {
		await requireNonViewer();
		throw redirect({
			to: '/settings/project/agent',
			search: { tab: 'memory' },
		});
	},
});
