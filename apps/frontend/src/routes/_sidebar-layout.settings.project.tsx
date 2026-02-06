import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import SlackIcon from '@/components/icons/slack.svg';
import { Input } from '@/components/ui/input';
import { trpc } from '@/main';
import { SettingsCard } from '@/components/ui/settings-card';
import { LlmProvidersSection } from '@/components/settings-llm-providers-section';
import { SlackConfigSection } from '@/components/settings-slack-config-section';
import { UsersList } from '@/components/settings-display-users';
import { ModifyUserForm } from '@/components/settings-modify-user-form';
import { GoogleConfigSection } from '@/components/settings-google-credentials-section';
import { SavedPrompts } from '@/components/settings-saved-prompts';

export const Route = createFileRoute('/_sidebar-layout/settings/project')({
	component: RouteComponent,
});

function RouteComponent() {
	return <ProjectPage />;
}

function ProjectPage() {
	const project = useQuery(trpc.project.getCurrent.queryOptions());

	const isAdmin = project.data?.userRole === 'admin';

	return (
		<>
			<div className='flex items-center justify-between'>
				<h1 className='text-2xl font-semibold text-foreground'>Project</h1>
				{project.data?.userRole && (
					<span className='px-2.5 py-0.5 text-xs font-medium rounded-full bg-primary/10 text-primary capitalize'>
						{project.data.userRole}
					</span>
				)}
			</div>

			{project.data ? (
				<>
					<SettingsCard>
						<div className='grid gap-4'>
							<div className='grid gap-2'>
								<label htmlFor='project-name' className='text-sm font-medium text-foreground'>
									Name
								</label>
								<Input id='project-name' value={project.data.name} readOnly className='bg-muted/50' />
							</div>
							<div className='grid gap-2'>
								<label htmlFor='project-path' className='text-sm font-medium text-foreground'>
									Path
								</label>
								<Input
									id='project-path'
									value={project.data.path ?? ''}
									readOnly
									className='bg-muted/50 font-mono text-sm'
								/>
							</div>
						</div>
					</SettingsCard>

					<SettingsCard title='LLM Configuration'>
						<LlmProvidersSection isAdmin={isAdmin} />
					</SettingsCard>

					<SavedPrompts isAdmin={isAdmin} />

					<SettingsCard icon={<SlackIcon />} title='Slack Integration'>
						<SlackConfigSection isAdmin={isAdmin} />
					</SettingsCard>

					<SettingsCard title='Google Credentials'>
						<GoogleConfigSection isAdmin={isAdmin} />
					</SettingsCard>

					<SettingsCard title='Team'>
						<UsersList isAdmin={isAdmin} />
					</SettingsCard>

					<ModifyUserForm isAdmin={isAdmin} />
				</>
			) : (
				<SettingsCard>
					<p className='text-sm text-muted-foreground'>
						No project configured. Set NAO_DEFAULT_PROJECT_PATH environment variable.
					</p>
				</SettingsCard>
			)}
		</>
	);
}
