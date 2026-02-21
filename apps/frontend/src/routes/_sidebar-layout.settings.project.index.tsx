import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { GoogleConfigSection } from '@/components/settings/google-credentials-section';
import { SettingsCard } from '@/components/ui/settings-card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/project/')({
	component: ProjectTabPage,
});

function ProjectTabPage() {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const isAdmin = project.data?.userRole === 'admin';

	return (
		<>
			<SettingsCard title='Project Information'>
				<div className='grid gap-2'>
					<label htmlFor='project-name' className='text-sm font-medium text-foreground'>
						Name
					</label>
					<Input id='project-name' value={project.data?.name ?? ''} readOnly className='bg-muted/50' />
				</div>
				<div className='grid gap-2'>
					<label htmlFor='project-path' className='text-sm font-medium text-foreground'>
						Path
					</label>
					<Input
						id='project-path'
						value={project.data?.path ?? ''}
						readOnly
						className='bg-muted/50 font-mono text-sm'
					/>
				</div>
			</SettingsCard>

			<SettingsCard title='Google Credentials'>
				{project.isLoading ? (
					<div className='space-y-2'>
						<Skeleton className='h-4 w-40' />
						<Skeleton className='h-4 w-full max-w-xs' />
					</div>
				) : (
					<GoogleConfigSection isAdmin={isAdmin} />
				)}
			</SettingsCard>
		</>
	);
}
