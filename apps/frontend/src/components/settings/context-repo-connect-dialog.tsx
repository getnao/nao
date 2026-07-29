import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Github, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { RepoProvider } from '@nao/shared/types';

import type { GithubRepo } from '@/components/settings/github-repo-list';
import type { GitlabProject } from '@/components/settings/gitlab-repo-list';
import { GithubRepoList } from '@/components/settings/github-repo-list';
import GitlabIcon from '@/components/icons/gitlab-icon.svg';
import { GitlabRepoList } from '@/components/settings/gitlab-repo-list';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { ErrorMessage } from '@/components/ui/error-message';
import { trpc } from '@/main';

export interface RepositoryConnectionResult {
	provider: RepoProvider;
	repoFullName: string;
	branch: string;
	connectionType: 'linked-existing-commit' | 'published-initial-commit';
}

interface ContextRepoConnectDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConnected: (result: RepositoryConnectionResult) => void;
}

interface SelectedRepository {
	fullName: string;
	branch: string;
}

export function ContextRepoConnectDialog({ open, onOpenChange, onConnected }: ContextRepoConnectDialogProps) {
	const queryClient = useQueryClient();
	const [provider, setProvider] = useState<RepoProvider>('github');
	const [selected, setSelected] = useState<SelectedRepository | null>(null);
	const [confirming, setConfirming] = useState(false);
	const githubAvailable = useQuery(trpc.github.isAvailable.queryOptions());
	const gitlabAvailable = useQuery(trpc.gitlab.isAvailable.queryOptions());
	const githubStatus = useQuery({
		...trpc.github.getStatus.queryOptions(),
		enabled: open && githubAvailable.data === true,
	});
	const gitlabStatus = useQuery({
		...trpc.gitlab.getStatus.queryOptions(),
		enabled: open && gitlabAvailable.data === true,
	});

	const connectRepository = useMutation(
		trpc.contextExplorer.connectRepository.mutationOptions({
			onSuccess: async (result) => {
				await Promise.all([
					queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getRepositoryStatus.queryKey() }),
					queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getFileTree.queryKey() }),
					queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getChangedFiles.queryKey() }),
					queryClient.invalidateQueries({ queryKey: trpc.github.getProjectGitInfo.queryKey() }),
					queryClient.invalidateQueries({ queryKey: trpc.gitlab.getProjectGitInfo.queryKey() }),
				]);
				onConnected(result);
				setConfirming(false);
				onOpenChange(false);
				setSelected(null);
			},
		}),
	);

	useEffect(() => {
		if (githubAvailable.data === false && gitlabAvailable.data === true) {
			setProvider('gitlab');
		}
	}, [githubAvailable.data, gitlabAvailable.data]);

	const handleOpenChange = (nextOpen: boolean) => {
		if (connectRepository.isPending) {
			return;
		}
		onOpenChange(nextOpen);
		if (!nextOpen) {
			setSelected(null);
			setConfirming(false);
			connectRepository.reset();
		}
	};

	const handleProviderChange = (nextProvider: RepoProvider) => {
		setProvider(nextProvider);
		setSelected(null);
		connectRepository.reset();
	};

	const handleGithubSelect = (fullName: string, repo: GithubRepo) => {
		setSelected(selected?.fullName === fullName ? null : { fullName, branch: repo.default_branch || 'main' });
	};

	const handleGitlabSelect = (fullName: string, project: GitlabProject) => {
		setSelected(selected?.fullName === fullName ? null : { fullName, branch: project.default_branch || 'main' });
	};

	const providerAvailable = provider === 'github' ? githubAvailable.data === true : gitlabAvailable.data === true;
	const providerConnected =
		provider === 'github' ? githubStatus.data?.connected === true : gitlabStatus.data?.connected === true;
	const providerLabel = provider === 'github' ? 'GitHub' : 'GitLab';

	return (
		<>
			<Dialog open={open} onOpenChange={handleOpenChange}>
				<DialogContent className='sm:max-w-lg'>
					<DialogHeader>
						<DialogTitle>Connect a repository</DialogTitle>
						<DialogDescription>
							Choose the repository that should track this project's context files.
						</DialogDescription>
					</DialogHeader>

					<div className='flex gap-2'>
						{githubAvailable.data === true && (
							<Button
								variant={provider === 'github' ? 'secondary' : 'outline'}
								size='sm'
								onClick={() => handleProviderChange('github')}
							>
								<Github className='size-4' />
								GitHub
							</Button>
						)}
						{gitlabAvailable.data === true && (
							<Button
								variant={provider === 'gitlab' ? 'secondary' : 'outline'}
								size='sm'
								onClick={() => handleProviderChange('gitlab')}
							>
								<GitlabIcon className='size-4' />
								GitLab
							</Button>
						)}
					</div>

					{!providerAvailable ? (
						<p className='text-sm text-muted-foreground'>No repository provider is configured.</p>
					) : !providerConnected ? (
						<div className='rounded-lg border p-4 text-sm'>
							<a href={`/api/${provider}/connect`} className='font-medium text-primary hover:underline'>
								Connect your {providerLabel} account
							</a>{' '}
							to choose a repository.
						</div>
					) : provider === 'github' ? (
						<GithubRepoList selected={selected?.fullName ?? null} onSelect={handleGithubSelect} />
					) : (
						<GitlabRepoList selected={selected?.fullName ?? null} onSelect={handleGitlabSelect} />
					)}

					<DialogFooter>
						<Button variant='outline' onClick={() => handleOpenChange(false)}>
							Cancel
						</Button>
						<Button
							disabled={!selected || !providerConnected}
							onClick={() => {
								connectRepository.reset();
								setConfirming(true);
							}}
						>
							Review connection
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={confirming}
				onOpenChange={(nextOpen) => !connectRepository.isPending && setConfirming(nextOpen)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Connect {selected?.fullName}?</AlertDialogTitle>
						<AlertDialogDescription>
							Connecting this repository will not overwrite or replace any files in this project. Current
							files will be compared with the {selected?.branch} branch.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{connectRepository.error && <ErrorMessage message={connectRepository.error.message} />}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={connectRepository.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							disabled={!selected || connectRepository.isPending}
							onClick={(event) => {
								event.preventDefault();
								if (selected) {
									connectRepository.mutate({
										provider,
										repoFullName: selected.fullName,
										branch: selected.branch,
									});
								}
							}}
						>
							{connectRepository.isPending && <Loader2 className='size-4 animate-spin' />}
							Connect repository
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
