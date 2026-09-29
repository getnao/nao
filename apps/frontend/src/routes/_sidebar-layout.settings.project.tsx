import { createFileRoute, Outlet, redirect, useMatches } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Github } from 'lucide-react';
import { GitHubRepoPicker } from '@/components/settings/github-repo-picker';
import { GitLabRepoPicker } from '@/components/settings/gitlab-repo-picker';
import { ImportProviderCard } from '@/components/settings/import-provider-card';
import GitlabIcon from '@/components/icons/gitlab-icon.svg';
import { OrgApiKeys } from '@/components/settings/org-api-keys';
import { useIsCloud } from '@/hooks/use-nao-mode';
import { usePermissions } from '@/hooks/use-permissions';
import { queryClient, trpc } from '@/main';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { Empty } from '@/components/ui/empty';

declare module '@tanstack/react-router' {
	interface StaticDataRouteOption {
		title?: string;
		description?: string;
	}
}

export const Route = createFileRoute('/_sidebar-layout/settings/project')({
	beforeLoad: async () => {
		const project = await queryClient.ensureQueryData(trpc.project.getCurrent.queryOptions());
		if (project?.userRole === 'viewer') {
			throw redirect({ to: '/settings/account' });
		}
	},
	component: ProjectPage,
});

function ProjectPage() {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const { isOrgAdmin } = usePermissions();
	const pageHeader = useMatches().at(-1)?.staticData;
	const isCloud = useIsCloud();
	const isProjectlessCloud = !project.data && isCloud;

	const emptyMessage = isCloud
		? 'No project found. Create a project or ask your organization admin to add you to one.'
		: 'No project configured. Set NAO_DEFAULT_PROJECT_PATH environment variable.';

	return (
		<SettingsPageWrapper>
			<div className='flex flex-col gap-5'>
				{pageHeader?.title && (
					<div>
						<h1 className='text-lg font-semibold text-foreground'>{pageHeader.title}</h1>
						{pageHeader.description && (
							<p className='text-sm text-muted-foreground'>{pageHeader.description}</p>
						)}
					</div>
				)}
				<div className='flex flex-col gap-12 min-w-0 mb-4'>
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
		</SettingsPageWrapper>
	);
}

function NoProjectCloudState({ isAdmin }: { isAdmin: boolean }) {
	const deployUrl = typeof window === 'undefined' ? '' : window.location.origin;

	const githubAvailable = useQuery(trpc.github.isAvailable.queryOptions());
	const githubStatus = useQuery({
		...trpc.github.getStatus.queryOptions(),
		enabled: githubAvailable.data === true,
	});
	const isGithubConnected = githubStatus.data?.connected === true;
	const showGithubOption = githubAvailable.data === true;

	const gitlabAvailable = useQuery(trpc.gitlab.isAvailable.queryOptions());
	const gitlabStatus = useQuery({
		...trpc.gitlab.getStatus.queryOptions(),
		enabled: gitlabAvailable.data === true,
	});
	const isGitlabConnected = gitlabStatus.data?.connected === true;
	const showGitlabOption = gitlabAvailable.data === true;

	return (
		<div className='flex flex-col gap-6'>
			{showGithubOption && (
				<ImportProviderCard
					providerLabel='GitHub'
					icon={Github}
					connectHref='/api/github/connect'
					resourceNounSingular='repository'
					resourceNounPlural='repositories'
					connected={isGithubConnected}
					Picker={GitHubRepoPicker}
				/>
			)}

			{showGitlabOption && (
				<ImportProviderCard
					providerLabel='GitLab'
					icon={GitlabIcon}
					connectHref='/api/gitlab/connect'
					resourceNounSingular='project'
					resourceNounPlural='projects'
					connected={isGitlabConnected}
					Picker={GitLabRepoPicker}
				/>
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
		</div>
	);
}
