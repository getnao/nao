import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { BudgetSettings } from '@/components/settings/budget-settings';
import { EnvVarsSection } from '@/components/settings/env-vars-section';
import { SettingsCard } from '@/components/ui/settings-card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermissions } from '@/hooks/use-permissions';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/project/')({
	staticData: {
		title: 'Project Settings',
	},
	component: ProjectSettingsPage,
});

function ProjectSettingsPage() {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const { isAdmin } = usePermissions();

	return (
		<>
			<SettingsCard title='Information'>
				{project.isLoading ? (
					<>
						<DetailRow label='Name' value={<Skeleton className='h-4 w-40' />} />
						<DetailRow label='Path' value={<Skeleton className='h-3 w-96 max-w-full' />} />
					</>
				) : project.data ? (
					<>
						<DetailRow label='Name' value={project.data.name} />
						{project.data.path && (
							<DetailRow
								label='Path'
								value={<code className='font-mono text-xs'>{project.data.path}</code>}
							/>
						)}
					</>
				) : null}
			</SettingsCard>

			<EnvVarsSection isAdmin={isAdmin} />

			<BudgetSettings />
		</>
	);
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className='flex items-center justify-between gap-4 py-1'>
			<span className='text-sm text-muted-foreground shrink-0'>{label}</span>
			<div className='text-sm text-foreground text-right min-w-0 break-all'>{value}</div>
		</div>
	);
}
