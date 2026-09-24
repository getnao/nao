import { createFileRoute } from '@tanstack/react-router';

import { OrganizationBillingSettings } from '@/components/settings/organization-billing-settings';
import { requireCloudBilling } from '@/lib/require-admin';

export const Route = createFileRoute('/_sidebar-layout/settings/organization/billing')({
	beforeLoad: requireCloudBilling,
	validateSearch: (search: Record<string, unknown>) => ({
		checkout:
			search.checkout === 'success' || search.checkout === 'subscribed' || search.checkout === 'canceled'
				? search.checkout
				: undefined,
		portal: search.portal === 'returned' ? search.portal : undefined,
	}),
	staticData: {
		title: 'Plan & Billing',
	},
	component: PlanAndBillingPage,
});

function PlanAndBillingPage() {
	return <OrganizationBillingSettings search={Route.useSearch()} />;
}
