import { createFileRoute } from '@tanstack/react-router';
import { SettingsCard } from '@/components/ui/settings-card';

export const Route = createFileRoute('/_sidebar-layout/settings/usage')({
	component: UsagePage,
});

function UsagePage() {
	return (
		<>
			<h1 className='text-2xl font-semibold text-foreground'>Usage & costs</h1>

			<SettingsCard>
				<div className='flex flex-col items-center justify-center py-8 text-center'>
					<p className='text-muted-foreground'>Usage tracking coming soon.</p>
					<p className='text-sm text-muted-foreground mt-1'>
						Monitor your API usage and costs across different LLM providers.
					</p>
				</div>
			</SettingsCard>
		</>
	);
}
