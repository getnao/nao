import { createFileRoute, redirect } from '@tanstack/react-router';

import { OrganizationCreditsContent } from '@/components/settings/credits-wallet-content';
import { SettingsPageWrapper } from '@/components/ui/settings-card';
import { requireOrganizationAdminCloud } from '@/lib/route-guards';

export const Route = createFileRoute('/_sidebar-layout/settings/credits-wallet')({
	beforeLoad: async () => {
		const config = await requireOrganizationAdminCloud();
		if (config.cloudBillingEnabled) {
			throw redirect({
				to: '/settings/organization/billing',
				search: { checkout: undefined, portal: undefined, creditCheckout: undefined },
			});
		}
	},
	component: CreditsWalletPage,
});

function CreditsWalletPage() {
	return (
		<SettingsPageWrapper>
			<div className='flex flex-col gap-5'>
				<div>
					<h1 className='text-lg font-semibold text-foreground'>Organization credits</h1>
					<p className='text-sm text-muted-foreground'>
						View your organization&apos;s nao credit balance and credit history.
					</p>
				</div>
				<OrganizationCreditsContent canTopUp={false} />
			</div>
		</SettingsPageWrapper>
	);
}
