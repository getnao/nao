import { useQuery } from '@tanstack/react-query';
import { GitBranch, Github } from 'lucide-react';
import { useState } from 'react';

import type { RepositoryConnectionResult } from '@/components/settings/context-repo-connect-dialog';
import GitlabIcon from '@/components/icons/gitlab-icon.svg';
import { ContextRepoConnectDialog } from '@/components/settings/context-repo-connect-dialog';
import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/ui/settings-card';
import { Skeleton } from '@/components/ui/skeleton';
import { trpc } from '@/main';

function formatRelativeDate(isoDate: string): string {
	const date = new Date(isoDate);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60_000);

	if (diffMins < 1) {
		return 'just now';
	}
	if (diffMins < 60) {
		return `${diffMins}m ago`;
	}
	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) {
		return `${diffHours}h ago`;
	}
	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 30) {
		return `${diffDays}d ago`;
	}
	return date.toLocaleDateString();
}

export function GitSyncSection() {
	const [connectDialogOpen, setConnectDialogOpen] = useState(false);
	const [connectionResult, setConnectionResult] = useState<RepositoryConnectionResult | null>(null);

	const repositoryStatus = useQuery({
		...trpc.contextExplorer.getRepositoryStatus.queryOptions(),
		staleTime: 30_000,
	});

	if (repositoryStatus.isLoading) {
		return (
			<div id='repository'>
				<SettingsCard title='Repository' icon={<Github className='size-4' />}>
					<Skeleton className='h-4 w-48' />
				</SettingsCard>
			</div>
		);
	}

	const status = repositoryStatus.data;
	if (!status?.repo) {
		const message = status?.managedByContextSource
			? 'This project repository is managed by NAO_CONTEXT_SOURCE=git. Update that deployment setting to change it.'
			: status?.isGitRepository
				? 'This project already has Git metadata but no supported GitHub or GitLab origin. Its existing Git metadata will not be changed.'
				: 'Connect a GitHub or GitLab repository to edit context files and propose changes.';

		return (
			<div id='repository'>
				<SettingsCard
					title='Repository'
					icon={<GitBranch className='size-4' />}
					action={
						!status?.managedByContextSource &&
						!status?.isGitRepository && (
							<Button size='sm' onClick={() => setConnectDialogOpen(true)}>
								Connect repository
							</Button>
						)
					}
				>
					<p className='text-sm text-muted-foreground'>{message}</p>
					{!status?.managedByContextSource && !status?.isGitRepository && (
						<p className='text-xs text-muted-foreground'>
							Connecting a repository will not overwrite or replace any files in this project.
						</p>
					)}
				</SettingsCard>
				<ContextRepoConnectDialog
					open={connectDialogOpen}
					onOpenChange={setConnectDialogOpen}
					onConnected={setConnectionResult}
				/>
			</div>
		);
	}

	const { repoFullName, branch, provider } = status.repo;
	const repositoryUrl = status.repositoryUrl?.replace(/\.git$/, '');
	const ProviderIcon = provider === 'github' ? Github : GitlabIcon;

	return (
		<div id='repository'>
			<SettingsCard title='Repository' icon={<ProviderIcon className='size-4' />}>
				<div className='flex flex-col gap-2'>
					<div className='flex items-center gap-2 text-sm'>
						<a
							href={repositoryUrl}
							target='_blank'
							rel='noopener noreferrer'
							className='font-mono text-foreground hover:underline'
						>
							{repoFullName}
						</a>
						{branch && (
							<span className='flex items-center gap-1 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded'>
								<GitBranch className='size-3' />
								{branch}
							</span>
						)}
					</div>
					{status.lastCommitMessage && (
						<p className='text-xs text-muted-foreground truncate'>
							{status.lastCommitMessage}
							{status.lastCommitDate && (
								<span className='ml-1.5 opacity-70'>
									&middot; {formatRelativeDate(status.lastCommitDate)}
								</span>
							)}
						</p>
					)}
					{connectionResult && (
						<p className='text-xs text-muted-foreground'>
							{connectionResult.connectionType === 'published-initial-commit'
								? 'Connected and published the current project files as the first commit.'
								: 'Connected without changing any project files.'}
						</p>
					)}
				</div>
			</SettingsCard>
		</div>
	);
}
