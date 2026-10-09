import { createFileRoute } from '@tanstack/react-router';

import { CreditsAiUsage } from '@/components/settings/credits-ai-usage';
import { SettingsPageWrapper } from '@/components/ui/settings-card';
import { requireCloud } from '@/lib/require-admin';

export const Route = createFileRoute('/_sidebar-layout/settings/credits-wallet')({
	beforeLoad: requireCloud,
	component: CreditsWalletPage,
});

function CreditsWalletPage() {
	return (
		<SettingsPageWrapper>
			<div className='flex flex-col gap-5'>
				<div>
					<h1 className='text-lg font-semibold text-foreground'>Credits & wallet</h1>
					<p className='text-sm text-muted-foreground'>
						View your organization's credit balance, wallet history, and chat usage.
					</p>
				</div>
				<CreditsAiUsage />
			</div>
		</SettingsPageWrapper>
	);
}
