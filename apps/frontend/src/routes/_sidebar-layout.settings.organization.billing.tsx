import { createFileRoute } from '@tanstack/react-router';

import type { OrganizationBillingSearch, OrganizationBillingTab } from '@/hooks/use-organization-billing';
import { OrganizationBillingSettings } from '@/components/settings/organization-billing-settings';
import { requireOrganizationAdminCloudBilling } from '@/lib/route-guards';

export const Route = createFileRoute('/_sidebar-layout/settings/organization/billing')({
	beforeLoad: requireOrganizationAdminCloudBilling,
	validateSearch: (search: Record<string, unknown>): OrganizationBillingSearch => ({
		checkout:
			search.checkout === 'success' || search.checkout === 'subscribed' || search.checkout === 'canceled'
				? search.checkout
				: undefined,
		checkoutPlan:
			search.checkoutPlan === 'team' || search.checkoutPlan === 'unlimited' ? search.checkoutPlan : undefined,
		portal: search.portal === 'returned' ? search.portal : undefined,
		creditCheckout:
			typeof search.creditCheckout === 'string' &&
			(search.creditCheckout === 'canceled' || search.creditCheckout.startsWith('cs_'))
				? search.creditCheckout
				: undefined,
		creditsTab: search.creditsTab === 'history' || search.creditsTab === 'usage' ? search.creditsTab : undefined,
		tab:
			search.tab === 'plans' || search.tab === 'seats' || search.tab === 'credits' || search.tab === 'invoices'
				? search.tab
				: undefined,
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
			onTabChange={(tab: OrganizationBillingTab) => {
				navigate({
					search: (current) => ({ ...current, tab }),
					replace: true,
					resetScroll: false,
				});
			}}
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
