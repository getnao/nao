import { createFileRoute, redirect } from '@tanstack/react-router';

import { requireOrganizationAdminCloudBilling } from '@/lib/route-guards';

export const Route = createFileRoute('/_sidebar-layout/settings/credits-wallet')({
	beforeLoad: async () => {
		await requireOrganizationAdminCloudBilling();
		throw redirect({
			to: '/settings/organization/billing',
			search: { checkout: undefined, portal: undefined, creditCheckout: undefined },
		});
	},
});
