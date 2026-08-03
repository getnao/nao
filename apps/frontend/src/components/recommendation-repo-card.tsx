import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { GitBranch, Github } from 'lucide-react';

import type { RepoProvider } from '@nao/shared/types';

import GitlabIcon from '@/components/icons/gitlab-icon.svg';
import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/ui/settings-card';
import { Skeleton } from '@/components/ui/skeleton';
import { trpc } from '@/main';

export function RecommendationRepoCard() {
	const repo = useQuery({
		...trpc.contextRecommendation.getRepo.queryOptions(),
		staleTime: 30_000,
	});
	const linkedRepos = useQuery({
		...trpc.contextRecommendation.listLinkedRepos.queryOptions(),
		staleTime: 30_000,
	});

	if (repo.isLoading) {
		return (
			<SettingsCard title='Repository' icon={<Github className='size-4' />}>
				<Skeleton className='h-4 w-48' />
			</SettingsCard>
		);
	}

	if (!repo.data) {
		return (
			<SettingsCard
				title='Repository'
				icon={<Github className='size-4' />}
				description='Connect a context repository on the Git settings page so recommendations can include proposed changes.'
				action={<GitSettingsLink label='Open Git settings' />}
			>
				<LinkedReposList repos={linkedRepos.data ?? []} />
			</SettingsCard>
		);
	}

	const { repoFullName, branch, provider, webUrl } = repo.data;
	const ProviderIcon = provider === 'gitlab' ? GitlabIcon : Github;

	return (
		<SettingsCard
			title='Repository'
			icon={<ProviderIcon className='size-4' />}
			description='Pull requests with drafted context changes are opened against this repository.'
			action={<GitSettingsLink label='Manage in Git settings' />}
		>
			<div className='flex flex-wrap items-center gap-2 text-sm'>
				<a
					href={webUrl}
					target='_blank'
					rel='noopener noreferrer'
					className='font-mono text-foreground hover:underline'
				>
					{repoFullName}
				</a>
				{branch && (
					<span className='flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground'>
						<GitBranch className='size-3' />
						{branch}
					</span>
				)}
			</div>
			<LinkedReposList repos={linkedRepos.data ?? []} />
		</SettingsCard>
	);
}

function GitSettingsLink({ label }: { label: string }) {
	return (
		<Button size='sm' variant='outline' asChild>
			<Link to='/settings/git'>{label}</Link>
		</Button>
	);
}

interface LinkedRepo {
	name: string;
	contextPath: string;
	repoFullName: string | null;
	branch: string | null;
	url: string | null;
	localPath: string | null;
	provider: RepoProvider | null;
}

function LinkedReposList({ repos }: { repos: LinkedRepo[] }) {
	if (repos.length === 0) {
		return null;
	}
	return (
		<div className='flex flex-col gap-1.5 rounded-md border border-dashed bg-muted/30 p-2 text-xs'>
			<div className='font-medium text-muted-foreground'>Linked repos from nao_config.yaml</div>
			<div className='flex flex-col gap-1'>
				{repos.map((repo) => (
					<div key={repo.name} className='flex flex-wrap items-center gap-x-1.5 gap-y-1'>
						<span className='font-mono text-muted-foreground'>{repo.contextPath}/</span>
						<span className='text-muted-foreground'>→</span>
						{repo.repoFullName && repo.url ? (
							<a
								href={repo.url}
								target='_blank'
								rel='noopener noreferrer'
								className='font-mono text-foreground hover:underline'
							>
								{repo.repoFullName}
							</a>
						) : (
							<span className='font-mono text-muted-foreground'>
								{repo.localPath ?? repo.url ?? 'unlinked'}
							</span>
						)}
						{repo.branch && (
							<span className='flex items-center gap-1 rounded bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground'>
								<GitBranch className='size-3' />
								{repo.branch}
							</span>
						)}
					</div>
				))}
			</div>
		</div>
	);
}
