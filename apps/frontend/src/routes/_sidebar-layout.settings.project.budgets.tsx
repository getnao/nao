import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_sidebar-layout/settings/project/budgets')({
	beforeLoad: () => {
		throw redirect({
			to: '/settings/project',
		});
	},
});
