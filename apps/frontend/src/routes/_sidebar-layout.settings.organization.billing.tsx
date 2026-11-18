import { createFileRoute } from '@tanstack/react-router';

import type { OrganizationBillingSearch } from '@/hooks/use-organization-billing';
import { OrganizationBillingSettings } from '@/components/settings/organization-billing-settings';
import { requireOrganizationAdminCloudBilling } from '@/lib/route-guards';

export const Route = createFileRoute('/_sidebar-layout/settings/organization/billing')({
	beforeLoad: requireOrganizationAdminCloudBilling,
	validateSearch: (search: Record<string, unknown>): OrganizationBillingSearch => ({
		checkout:
			search.checkout === 'success' || search.checkout === 'subscribed' || search.checkout === 'canceled'
				? search.checkout
				: undefined,
		portal: search.portal === 'returned' ? search.portal : undefined,
		creditCheckout:
			typeof search.creditCheckout === 'string' &&
			(search.creditCheckout === 'canceled' || search.creditCheckout.startsWith('cs_'))
				? search.creditCheckout
				: undefined,
		creditsTab: search.creditsTab === 'history' || search.creditsTab === 'usage' ? search.creditsTab : undefined,
	}),
	staticData: {
		title: 'Billing & Credits',
	},
	component: PlanAndBillingPage,
});

function PlanAndBillingPage() {
	const search = Route.useSearch();
	const navigate = Route.useNavigate();

	return (
		<OrganizationBillingSettings
			search={search}
			onCreditsTabChange={(creditsTab) => {
				navigate({
					search: (current) => ({ ...current, creditsTab }),
					replace: true,
					resetScroll: false,
				});
			}}
		/>
	);
}
