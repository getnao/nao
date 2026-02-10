import { createFileRoute } from '@tanstack/react-router';
import { ThemeSelector } from '@/components/settings-theme-selector';
import { SettingsCard } from '@/components/ui/settings-card';

export const Route = createFileRoute('/_sidebar-layout/settings/appearance')({
	component: AppearancePage,
});

function AppearancePage() {
	return (
		<>
			<h1 className='text-2xl font-semibold text-foreground'>Appearance</h1>

			<SettingsCard title='Color mode'>
				<div className='flex justify-start'>
					<ThemeSelector />
				</div>
			</SettingsCard>
		</>
	);
}
