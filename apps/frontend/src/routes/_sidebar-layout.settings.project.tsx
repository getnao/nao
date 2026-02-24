import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { SettingsProjectNav } from '@/components/settings/project-nav';
import { trpc } from '@/main';
import { SettingsCard } from '@/components/ui/settings-card';
import { Empty } from '@/components/ui/empty';

export const Route = createFileRoute('/_sidebar-layout/settings/project')({
	component: ProjectPage,
});

function ProjectPage() {
	const project = useQuery(trpc.project.getCurrent.queryOptions());

	return (
		<div className='flex flex-col gap-5'>
			<h1 className='text-lg font-semibold text-foreground'>Project Settings</h1>
			<div className='flex flex-row gap-6'>
				<div className='flex flex-col items-start gap-2'>{project.data && <SettingsProjectNav />}</div>

				<div className='flex flex-col gap-12 flex-1 min-w-0 mb-4'>
					{project.data ? (
						<Outlet />
					) : (
						<SettingsCard>
							<Empty>No project configured. Set NAO_DEFAULT_PROJECT_PATH environment variable.</Empty>
						</SettingsCard>
					)}
				</div>
			</div>
		</div>
	);
}
