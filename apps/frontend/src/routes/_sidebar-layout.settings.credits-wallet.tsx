import { createFileRoute, redirect } from '@tanstack/react-router';

import { DEFAULT_USAGE_SEARCH } from '@/components/settings/usage-route-search';
import { requireCloud, requireUsageOrWalletAccess } from '@/lib/route-guards';

export const Route = createFileRoute('/_sidebar-layout/settings/credits-wallet')({
	beforeLoad: async () => {
		await requireCloud();
		await requireUsageOrWalletAccess();
		throw redirect({
			to: '/settings/usage',
			search: { ...DEFAULT_USAGE_SEARCH, tab: 'wallet' },
		});
	},
});
