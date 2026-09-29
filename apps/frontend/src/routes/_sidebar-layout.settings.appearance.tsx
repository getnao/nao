import { createFileRoute } from '@tanstack/react-router';

import { DateFormatSection } from '@/components/settings/date-format-section';
import { WhiteLabelSettings } from '@/components/settings/white-label-settings';
import { SettingsPageWrapper } from '@/components/ui/settings-card';
import { useIsCloud } from '@/hooks/use-nao-mode';
import { usePermissions } from '@/hooks/use-permissions';
import { requireNonViewer } from '@/lib/require-admin';

export const Route = createFileRoute('/_sidebar-layout/settings/appearance')({
	beforeLoad: requireNonViewer,
	staticData: {
		title: 'Appearance',
	},
	component: AppearancePage,
});

function AppearancePage() {
	const { isAdmin } = usePermissions();
	const isCloud = useIsCloud();

	return (
		<SettingsPageWrapper>
			<div className='flex flex-col gap-5'>
				<h1 className='text-lg font-semibold text-foreground'>Appearance</h1>
				<div className='flex min-w-0 flex-col gap-12'>
					<DateFormatSection isAdmin={isAdmin} />
					{!isCloud && (
						<section className='flex flex-col gap-6'>
							<h2 className='text-base font-semibold text-foreground'>Branding</h2>
							<WhiteLabelSettings isAdmin={isAdmin} />
						</section>
					)}
				</div>
			</div>
		</SettingsPageWrapper>
	);
}
