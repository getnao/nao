import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';

import { AutomationsList } from '@/components/automations-list';
import { MobileHeader } from '@/components/mobile-header';
import { Button } from '@/components/ui/button';
import { useEffectiveUserGroupFeatures } from '@/hooks/use-effective-user-group-features';
import { usePermissions } from '@/hooks/use-permissions';
import { requireAutomationsEnabled } from '@/lib/route-guards';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/automations/')({
	beforeLoad: async () => {
		await requireAutomationsEnabled();
	},
	component: AutomationsPage,
});

function AutomationsPage() {
	const { isViewer } = usePermissions();
	const { automationCreationEnabled } = useEffectiveUserGroupFeatures();
	const canCreateAutomation = automationCreationEnabled && !isViewer;
	const automations = useQuery({ ...trpc.automation.list.queryOptions(), enabled: !isViewer });

	return (
		<div className='flex flex-col flex-1 h-full overflow-auto bg-background'>
			<MobileHeader />
			<div className='mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 md:px-8 md:py-10'>
				<header className='flex items-center justify-between gap-3 flex-wrap'>
					<div>
						<h1 className='text-xl font-semibold tracking-tight'>Automations</h1>
						<p className='text-sm text-muted-foreground'>
							Scheduled and event-triggered agent runs for this project.
						</p>
					</div>
					{canCreateAutomation && (
						<Button variant='primary-gradient' asChild>
							<Link to='/automations/new'>
								<Plus className='size-4' />
								New automation
							</Link>
						</Button>
					)}
				</header>
				{automations.isError ? (
					<AutomationsLoadError message={automations.error.message} onRetry={() => automations.refetch()} />
				) : (
					<AutomationsList
						items={automations.data ?? []}
						isLoading={automations.isLoading}
						canCreateAutomation={canCreateAutomation}
					/>
				)}
			</div>
		</div>
	);
}

function AutomationsLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
	return (
		<div className='flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-background/40 p-10 text-center'>
			<p className='text-sm text-muted-foreground'>The automations could not be loaded: {message}</p>
			<Button variant='outline' size='sm' onClick={onRetry}>
				Try again
			</Button>
		</div>
	);
}
