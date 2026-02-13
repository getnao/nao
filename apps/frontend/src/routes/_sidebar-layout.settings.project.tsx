import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { ProjectSettingsTab } from '@/components/settings-project-nav';
import { projectSettingsTabs, SettingsProjectNav } from '@/components/settings-project-nav';
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
import { McpList } from '@/components/settings-display-mcp';
import { SettingsExperimental } from '@/components/settings-experimental';

type SearchParams = {
	tab?: ProjectSettingsTab;
};

export const Route = createFileRoute('/_sidebar-layout/settings/project')({
	component: RouteComponent,
	validateSearch: (search: Record<string, unknown>): SearchParams => {
		const tab = search.tab as string | undefined;
		return {
			tab:
				tab && projectSettingsTabs.includes(tab as ProjectSettingsTab)
					? (tab as ProjectSettingsTab)
					: undefined,
		};
	},
});

function RouteComponent() {
	return <ProjectPage />;
}

function ProjectPage() {
	const { tab } = Route.useSearch();
	const activeTab = tab ?? 'project';
	const project = useQuery(trpc.project.getCurrent.queryOptions());

	const isAdmin = project.data?.userRole === 'admin';
	const appVersion = useQuery({
		...trpc.system.version.queryOptions(),
		enabled: isAdmin,
	});

	return (
		<div className='flex flex-row gap-6'>
			<div className='flex flex-col items-start gap-2'>
				{project.data && <SettingsProjectNav activeTab={activeTab} />}
			</div>

			<div className='flex flex-col gap-6 flex-1 min-w-0'>
				{project.data ? (
					<>
						{activeTab === 'project' && (
							<div className='flex flex-col gap-4'>
								<SettingsCard>
									<div className='grid gap-4'>
										<div className='grid gap-2'>
											<label
												htmlFor='project-name'
												className='text-sm font-medium text-foreground'
											>
												Name
											</label>
											<Input
												id='project-name'
												value={project.data.name}
												readOnly
												className='bg-muted/50'
											/>
										</div>
										<div className='grid gap-2'>
											<label
												htmlFor='project-path'
												className='text-sm font-medium text-foreground'
											>
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

								<SettingsCard title='Google Credentials'>
									<GoogleConfigSection isAdmin={isAdmin} />
								</SettingsCard>

								{isAdmin && (
									<SettingsCard title='Application'>
										<div className='space-y-3 text-sm'>
											<div className='flex items-center justify-between gap-4 border-b border-border/60 pb-2'>
												<span className='text-muted-foreground'>Version</span>
												<span className='font-mono text-foreground'>
													{appVersion.data?.version ?? 'unknown'}
												</span>
											</div>
											<div className='flex items-center justify-between gap-4 border-b border-border/60 pb-2'>
												<span className='text-muted-foreground'>Commit</span>
												<span className='font-mono text-foreground'>
													{appVersion.data?.commit ?? 'unknown'}
												</span>
											</div>
											<div className='flex items-center justify-between gap-4'>
												<span className='text-muted-foreground'>Build date</span>
												<span className='font-mono text-foreground'>
													{appVersion.data?.buildDate || 'unknown'}
												</span>
											</div>
										</div>
									</SettingsCard>
								)}
							</div>
						)}

						{activeTab === 'models' && (
							<SettingsCard title='LLM Configuration'>
								<LlmProvidersSection isAdmin={isAdmin} />
							</SettingsCard>
						)}

						{activeTab === 'agent' && (
							<div className='flex flex-col gap-4'>
								<SavedPrompts isAdmin={isAdmin} />

								<SettingsExperimental isAdmin={isAdmin} />
							</div>
						)}

						{activeTab === 'mcp-servers' && (
							<SettingsCard title='MCP Servers'>
								<McpList isAdmin={isAdmin} />
							</SettingsCard>
						)}

						{activeTab === 'slack' && (
							<SettingsCard icon={<SlackIcon />} title='Slack Integration'>
								<SlackConfigSection isAdmin={isAdmin} />
							</SettingsCard>
						)}

						{activeTab === 'team' && (
							<div className='flex flex-col gap-4'>
								<SettingsCard title=''>
									<UsersList isAdmin={isAdmin} />
								</SettingsCard>

								<ModifyUserForm isAdmin={isAdmin} />
							</div>
						)}
					</>
				) : (
					<SettingsCard>
						<p className='text-sm text-muted-foreground'>
							No project configured. Set NAO_DEFAULT_PROJECT_PATH environment variable.
						</p>
					</SettingsCard>
				)}
			</div>
		</div>
	);
}
