import { useState } from 'react';
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Github } from 'lucide-react';
import { GitHubRepoPicker } from '@/components/settings/github-repo-picker';
import { OrgApiKeys } from '@/components/settings/org-api-keys';
import { SettingsProjectNav } from '@/components/settings/project-nav';
import { trpc } from '@/main';
import { Button } from '@/components/ui/button';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { Empty } from '@/components/ui/empty';

export const Route = createFileRoute('/_sidebar-layout/settings/project')({
	component: ProjectPage,
});

function ProjectPage() {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const org = useQuery({
		...trpc.organization.get.queryOptions(),
		enabled: !project.data,
	});
	const isCloud = config.data?.naoMode === 'cloud';
	const isOrgAdmin = org.data?.role === 'admin';
	const isProjectlessCloud = !project.data && isCloud;

	const emptyMessage = isCloud
		? 'No project found. Create a project or ask your organization admin to add you to one.'
		: 'No project configured. Set NAO_DEFAULT_PROJECT_PATH environment variable.';

	return (
		<SettingsPageWrapper>
			<div className='flex flex-col gap-5'>
				<h1 className='text-lg font-semibold text-foreground'>Project Settings</h1>
				<div className='flex flex-row gap-6'>
					{project.data && (
						<div className='flex flex-col items-start gap-2'>
							<SettingsProjectNav />
						</div>
					)}

					<div className='flex flex-col gap-12 flex-1 min-w-0 mb-4'>
						{project.data ? (
							<Outlet />
						) : isProjectlessCloud ? (
							<NoProjectCloudState isAdmin={isOrgAdmin} />
						) : (
							<SettingsCard>
								<Empty>{emptyMessage}</Empty>
							</SettingsCard>
						)}
					</div>
				</div>
			</div>
		</SettingsPageWrapper>
	);
}

function NoProjectCloudState({ isAdmin }: { isAdmin: boolean }) {
	const deployUrl = typeof window === 'undefined' ? '' : window.location.origin;
	const [repoPickerOpen, setRepoPickerOpen] = useState(false);
	const githubAvailable = useQuery(trpc.github.isAvailable.queryOptions());
	const githubStatus = useQuery({
		...trpc.github.getStatus.queryOptions(),
		enabled: githubAvailable.data === true,
	});
	const isGithubConnected = githubStatus.data?.connected === true;
	const showGithubOption = githubAvailable.data === true;

	return (
		<div className='flex flex-col gap-6'>
			{showGithubOption && (
				<SettingsCard
					title='Import from GitHub'
					description={
						isGithubConnected
							? 'Select a repository to import as a nao project.'
							: 'Connect your GitHub account to browse and import repositories.'
					}
					icon={<Github className='size-4' />}
				>
					{isGithubConnected ? (
						<div className='flex items-center justify-between'>
							<p className='text-sm text-muted-foreground'>
								Browse your repositories and import one as a project.
							</p>
							<Button variant='secondary' size='sm' onClick={() => setRepoPickerOpen(true)}>
								<Github className='size-3.5' />
								Browse repositories
							</Button>
						</div>
					) : (
						<div className='flex items-center justify-between'>
							<p className='text-sm text-muted-foreground'>GitHub is not connected yet.</p>
							<Button variant='secondary' size='sm' asChild>
								<a href='/api/github/connect'>
									<Github className='size-3.5' />
									Connect GitHub
								</a>
							</Button>
						</div>
					)}
				</SettingsCard>
			)}

			{isAdmin && (
				<>
					<SettingsCard title='Deploy your first project'>
						<div className='space-y-3 text-sm text-muted-foreground'>
							<p>
								Use <code>nao deploy</code> to send a local project context to this nao instance.
							</p>
							<p>
								Run it from the directory that contains <code>nao_config.yaml</code>, or add{' '}
								<code>--path /path/to/project</code> if you want to deploy from somewhere else.
							</p>
						</div>
					</SettingsCard>

					<OrgApiKeys
						isAdmin
						deployUrl={deployUrl}
						title='Generate a deploy key'
						description='Create an organization API key and copy the exact command you can run to deploy your first project.'
					/>
				</>
			)}

			<GitHubRepoPicker open={repoPickerOpen} onOpenChange={setRepoPickerOpen} />
		</div>
	);
}
