import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Plus, Timer } from 'lucide-react';
import { useState } from 'react';

import type { AutomationFormValue } from '@/components/automations-form';
import { MobileHeader } from '@/components/mobile-header';
import { AutomationForm } from '@/components/automations-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/ui/settings-card';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/automations/')({
	component: AutomationsPage,
});

function AutomationsPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [isCreating, setIsCreating] = useState(false);
	const automations = useQuery(trpc.automation.list.queryOptions());
	const createAutomation = useMutation(trpc.automation.create.mutationOptions());

	async function handleCreate(value: AutomationFormValue) {
		const created = await createAutomation.mutateAsync(value);
		await queryClient.invalidateQueries({ queryKey: trpc.automation.list.queryKey() });
		setIsCreating(false);
		navigate({ to: '/automations/$automationId', params: { automationId: created.id } });
	}

	const items = automations.data ?? [];

	return (
		<div className='flex flex-col flex-1 h-full overflow-auto bg-panel'>
			<MobileHeader />
			<div className='w-full px-4 py-6 md:px-8 md:py-10'>
				<div className='flex items-center justify-between mb-6 md:mb-8 gap-3 flex-wrap'>
					<div>
						<h1 className='text-xl font-semibold tracking-tight'>Automations</h1>
						<p className='text-sm text-muted-foreground'>
							Run recurring prompt automations and let them use MCP, email, Slack, and GitHub.
						</p>
					</div>
					<Button onClick={() => setIsCreating((value) => !value)}>
						<Plus className='size-4' />
						New automation
					</Button>
				</div>

				{isCreating && (
					<div className='mb-6'>
						<SettingsCard title='New automation'>
							<AutomationForm
								submitLabel='Create automation'
								isPending={createAutomation.isPending}
								onSubmit={handleCreate}
							/>
						</SettingsCard>
					</div>
				)}

				{items.length === 0 && !isCreating && (
					<div className='flex flex-col items-center justify-center rounded-lg border border-dashed p-10 text-center'>
						<Timer className='size-8 text-muted-foreground mb-3' />
						<h2 className='font-medium'>No automations yet</h2>
						<p className='text-sm text-muted-foreground mt-1'>Create one to run a recurring automation.</p>
					</div>
				)}

				<div className='grid gap-3'>
					{items.map((item) => (
						<Link
							key={item.id}
							to='/automations/$automationId'
							params={{ automationId: item.id }}
							className='rounded-lg border bg-background/60 p-4 hover:bg-muted/50 transition-colors'
						>
							<div className='flex items-start justify-between gap-3'>
								<div>
									<div className='font-medium'>{item.title}</div>
									<div className='text-sm text-muted-foreground'>
										{item.scheduleDescription || item.cron}
									</div>
								</div>
								<Badge variant={item.enabled ? 'default' : 'secondary'}>
									{item.enabled ? 'Enabled' : 'Paused'}
								</Badge>
							</div>
							<div className='text-xs text-muted-foreground mt-3'>
								Last run:{' '}
								{item.lastRunStartedAt
									? `${item.lastRunStatus ?? 'unknown'} at ${new Date(item.lastRunStartedAt).toLocaleString()}`
									: 'Never'}
							</div>
						</Link>
					))}
				</div>
			</div>
		</div>
	);
}
