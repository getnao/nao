import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Github } from 'lucide-react';
import { useState } from 'react';
import { USER_ROLE_LABELS } from '@nao/shared/types';

import { GitHubRepoPicker } from '@/components/settings/github-repo-picker';
import { GitLabRepoPicker } from '@/components/settings/gitlab-repo-picker';
import GitlabIcon from '@/components/icons/gitlab-icon.svg';
import { GoogleConfigSection } from '@/components/settings/google-credentials-section';
import { EditableOrganizationName } from '@/components/settings/editable-organization-name';
import { OrgApiKeys } from '@/components/settings/org-api-keys';
import { OrgSignInDomains } from '@/components/settings/org-signin-domains';
import { SsoSettingsSection } from '@/components/settings/sso-settings-section';
import { SsoTokenInspector } from '@/components/settings/sso-token-inspector';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useIsCloud } from '@/hooks/use-nao-mode';
import { usePermissions } from '@/hooks/use-permissions';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/organization/')({
	component: OrganizationSettingsPage,
});

function OrganizationSettingsPage() {
	const org = useQuery(trpc.organization.get.queryOptions());
	const projectsQuery = useQuery(trpc.organization.getProjects.queryOptions());
	const { isOrgAdmin } = usePermissions();
	const isCloud = useIsCloud();

	const githubAvailable = useQuery(trpc.github.isAvailable.queryOptions());
	const githubStatus = useQuery({
		...trpc.github.getStatus.queryOptions(),
		enabled: githubAvailable.data === true,
	});

	const gitlabAvailable = useQuery(trpc.gitlab.isAvailable.queryOptions());
	const gitlabStatus = useQuery({
		...trpc.gitlab.getStatus.queryOptions(),
		enabled: gitlabAvailable.data === true,
	});

	const [repoPickerOpen, setRepoPickerOpen] = useState(false);
	const [gitlabPickerOpen, setGitlabPickerOpen] = useState(false);

	const isGithubConnected = githubStatus.data?.connected === true;
	const showGithubImport = githubAvailable.data === true;
	const isGitlabConnected = gitlabStatus.data?.connected === true;
	const showGitlabImport = gitlabAvailable.data === true;

	const projectsAction =
		showGithubImport || showGitlabImport ? (
			<div className='flex flex-wrap gap-2'>
				{showGithubImport &&
					(isGithubConnected ? (
						<Button variant='secondary' size='sm' onClick={() => setRepoPickerOpen(true)}>
							<Github className='size-3.5' />
							Import from GitHub
						</Button>
					) : (
						<Button variant='secondary' size='sm' asChild>
							<a href='/api/github/connect'>
								<Github className='size-3.5' />
								Import from GitHub
							</a>
						</Button>
					))}
				{showGitlabImport &&
					(isGitlabConnected ? (
						<Button variant='secondary' size='sm' onClick={() => setGitlabPickerOpen(true)}>
							<GitlabIcon className='size-3.5' />
							Import from GitLab
						</Button>
					) : (
						<Button variant='secondary' size='sm' asChild>
							<a href='/api/gitlab/connect'>
								<GitlabIcon className='size-3.5' />
								Import from GitLab
							</a>
						</Button>
					))}
			</div>
		) : undefined;

	return (
		<SettingsPageWrapper>
			<div className='flex flex-col gap-5'>
				<EditableOrganizationName name={org.data?.name ?? 'Organization'} canEdit={isOrgAdmin && !!org.data} />
				<div className='flex flex-col gap-12'>
					<SettingsCard title='Projects' action={projectsAction} flush>
						{projectsQuery.isLoading ? (
							<div className='p-4 text-sm text-muted-foreground'>Loading projects...</div>
						) : projectsQuery.data?.length ? (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Name</TableHead>
										<TableHead>Access</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{projectsQuery.data.map((project) => (
										<TableRow key={project.id}>
											<TableCell>
												<div className='font-medium'>{project.name}</div>
												{project.path && (
													<div className='font-mono text-xs text-muted-foreground'>
														{project.path}
													</div>
												)}
											</TableCell>
											<TableCell>
												<Badge variant={project.role}>{USER_ROLE_LABELS[project.role]}</Badge>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						) : (
							<div className='p-4 text-sm text-muted-foreground'>
								No projects found.{' '}
								<Link to='/settings/project' className='text-primary hover:underline'>
									Add a first project.
								</Link>
							</div>
						)}
					</SettingsCard>
					{isCloud && <OrgSignInDomains isAdmin={isOrgAdmin} />}
					{!isCloud && <SsoSettingsSection />}
					{!isCloud && isOrgAdmin && <SsoTokenInspector />}
					{!isCloud && (
						<SettingsCard title='Google sign-in'>
							<GoogleConfigSection isAdmin={isOrgAdmin} />
						</SettingsCard>
					)}
					<OrgApiKeys isAdmin={isOrgAdmin} />
				</div>
			</div>

			<GitHubRepoPicker open={repoPickerOpen} onOpenChange={setRepoPickerOpen} />
			<GitLabRepoPicker open={gitlabPickerOpen} onOpenChange={setGitlabPickerOpen} />
		</SettingsPageWrapper>
	);
}
