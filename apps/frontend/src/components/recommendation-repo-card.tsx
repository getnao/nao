import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitBranch, Github, Unlink } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { RepoProvider } from '@nao/shared/types';

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
import { GithubRepoList } from '@/components/settings/github-repo-list';
import { GitlabRepoList } from '@/components/settings/gitlab-repo-list';
import GitlabIcon from '@/components/icons/gitlab-icon.svg';
import { SettingsCard } from '@/components/ui/settings-card';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { trpc } from '@/main';

const RETURN_TO = '/settings/recommendations';

/**
 * Surfaces the repository that gates automatic PR/MR drafting. The project's own GitHub
 * or GitLab remote is used when present; otherwise admins can pick any repository here.
 */
export function RecommendationRepoCard() {
	const queryClient = useQueryClient();
	const [confirmUnlink, setConfirmUnlink] = useState(false);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [pickerProvider, setPickerProvider] = useState<RepoProvider>('github');

	const githubAvailable = useQuery(trpc.github.isAvailable.queryOptions());
	const gitlabAvailable = useQuery(trpc.gitlab.isAvailable.queryOptions());

	const githubStatus = useQuery({
		...trpc.github.getStatus.queryOptions(),
		enabled: githubAvailable.data === true,
	});
	const gitlabStatus = useQuery({
		...trpc.gitlab.getStatus.queryOptions(),
		enabled: gitlabAvailable.data === true,
	});

	const repo = useQuery({
		...trpc.contextRecommendation.getRepo.queryOptions(),
		staleTime: 30_000,
	});
	const linkedRepos = useQuery({
		...trpc.contextRecommendation.listLinkedRepos.queryOptions(),
		staleTime: 30_000,
	});

	const invalidateRepo = () => {
		queryClient.invalidateQueries({ queryKey: trpc.contextRecommendation.getRepo.queryKey() });
	};

	const unlinkGithub = useMutation(
		trpc.github.unlinkProject.mutationOptions({
			onSuccess: () => {
				setConfirmUnlink(false);
				invalidateRepo();
				queryClient.invalidateQueries({ queryKey: trpc.github.getProjectGitInfo.queryKey() });
			},
		}),
	);
	const unlinkGitlab = useMutation(
		trpc.gitlab.unlinkProject.mutationOptions({
			onSuccess: () => {
				setConfirmUnlink(false);
				invalidateRepo();
				queryClient.invalidateQueries({ queryKey: trpc.gitlab.getProjectGitInfo.queryKey() });
			},
		}),
	);
	const setRepo = useMutation(
		trpc.contextRecommendation.setRepo.mutationOptions({
			onSuccess: () => {
				setPickerOpen(false);
				invalidateRepo();
			},
		}),
	);

	const isLoading =
		githubAvailable.isLoading ||
		gitlabAvailable.isLoading ||
		githubStatus.isLoading ||
		gitlabStatus.isLoading ||
		repo.isLoading;

	const neitherAvailable = githubAvailable.data === false && gitlabAvailable.data === false;
	if (neitherAvailable) {
		return null;
	}

	const githubConnected = githubStatus.data?.connected === true;
	const gitlabConnected = gitlabStatus.data?.connected === true;
	const anyConnected = githubConnected || gitlabConnected;

	const cardIcon =
		repo.data?.provider === 'gitlab' ? <GitlabIcon className='size-4' /> : <Github className='size-4' />;

	if (isLoading) {
		return (
			<SettingsCard title='Repository' icon={<Github className='size-4' />}>
				<Skeleton className='h-4 w-48' />
			</SettingsCard>
		);
	}

	if (!anyConnected) {
		return (
			<SettingsCard
				title='Repository'
				icon={<Github className='size-4' />}
				description='Connect GitHub or GitLab so nao can draft pull requests that improve your context.'
			>
				<div className='flex flex-wrap gap-2'>
					{githubAvailable.data && (
						<Button size='sm' asChild>
							<a href={`/api/github/connect?returnTo=${RETURN_TO}`}>
								<Github className='size-3.5' />
								Connect GitHub
							</a>
						</Button>
					)}
					{gitlabAvailable.data && (
						<Button size='sm' variant='outline' asChild>
							<a href={`/api/gitlab/connect?returnTo=${RETURN_TO}`}>
								<GitlabIcon className='size-3.5' />
								Connect GitLab
							</a>
						</Button>
					)}
				</div>
			</SettingsCard>
		);
	}

	if (!repo.data) {
		return (
			<SettingsCard
				title='Repository'
				icon={<Github className='size-4' />}
				description='This project is not linked to a repository. Select the repository that holds your context files so nao can open pull requests against it.'
			>
				<div className='flex flex-col gap-3'>
					<div className='flex flex-wrap gap-2'>
						{githubConnected && (
							<Button
								size='sm'
								onClick={() => {
									setPickerProvider('github');
									setPickerOpen(true);
								}}
								className='self-start'
							>
								<Github className='size-3.5' />
								Select GitHub repository
							</Button>
						)}
						{gitlabConnected && (
							<Button
								size='sm'
								variant='outline'
								onClick={() => {
									setPickerProvider('gitlab');
									setPickerOpen(true);
								}}
								className='self-start'
							>
								<GitlabIcon className='size-3.5' />
								Select GitLab project
							</Button>
						)}
					</div>
					<LinkedReposList repos={linkedRepos.data ?? []} />
				</div>
				<RepoPickerDialog
					open={pickerOpen}
					provider={pickerProvider}
					onOpenChange={setPickerOpen}
					onConfirm={(repoFullName) => setRepo.mutate({ repoFullName, provider: pickerProvider })}
					isPending={setRepo.isPending}
					error={setRepo.error?.message}
				/>
			</SettingsCard>
		);
	}

	const { repoFullName, branch, source, provider, webUrl } = repo.data;
	const unlink = provider === 'gitlab' ? unlinkGitlab : unlinkGithub;

	return (
		<SettingsCard
			title='Repository'
			icon={cardIcon}
			description={
				source === 'project'
					? 'Connected. New high-impact recommendations include drafted changes you can open as a pull request.'
					: `Pull requests with drafted context changes are opened against this repository. Project files are not synced from it.`
			}
		>
			<div className='flex items-center justify-between gap-2 text-sm'>
				<div className='flex items-center gap-2'>
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
				{source === 'project' ? (
					<Button size='sm' variant='outline' onClick={() => setConfirmUnlink(true)}>
						<Unlink className='size-3.5' />
						Unattach
					</Button>
				) : (
					<div className='flex items-center gap-2'>
						<Button
							size='sm'
							variant='outline'
							onClick={() => {
								setPickerProvider(provider ?? 'github');
								setPickerOpen(true);
							}}
						>
							Change
						</Button>
						<Button
							size='sm'
							variant='outline'
							onClick={() => setRepo.mutate({ repoFullName: null })}
							disabled={setRepo.isPending}
						>
							{setRepo.isPending ? <Spinner className='size-3.5' /> : <Unlink className='size-3.5' />}
							Remove
						</Button>
					</div>
				)}
			</div>
			<LinkedReposList repos={linkedRepos.data ?? []} />
			{source !== 'project' && setRepo.error && (
				<p className='text-sm text-destructive'>{setRepo.error.message}</p>
			)}

			<RepoPickerDialog
				open={pickerOpen}
				provider={pickerProvider}
				onOpenChange={setPickerOpen}
				onConfirm={(name) => setRepo.mutate({ repoFullName: name, provider: pickerProvider })}
				isPending={setRepo.isPending}
				error={setRepo.error?.message}
			/>

			<AlertDialog open={confirmUnlink} onOpenChange={setConfirmUnlink}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Unattach repository?</AlertDialogTitle>
						<AlertDialogDescription>
							nao will stop drafting pull requests for this project until you link a repository again.
							Your project files and local git history are kept — only the link to{' '}
							<span className='font-mono'>{repoFullName}</span> is removed.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{unlink.error && <p className='text-sm text-destructive'>{unlink.error.message}</p>}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={unlink.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant='destructive'
							isLoading={unlink.isPending}
							onClick={(event) => {
								event.preventDefault();
								unlink.mutate();
							}}
						>
							Unattach
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</SettingsCard>
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

interface RepoPickerDialogProps {
	open: boolean;
	provider: RepoProvider;
	onOpenChange: (open: boolean) => void;
	onConfirm: (repoFullName: string) => void;
	isPending: boolean;
	error?: string;
}

function RepoPickerDialog({ open, provider, onOpenChange, onConfirm, isPending, error }: RepoPickerDialogProps) {
	const [selected, setSelected] = useState<string | null>(null);
	const isGitlab = provider === 'gitlab';

	useEffect(() => {
		setSelected(null);
	}, [provider, open]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-lg'>
				<DialogHeader>
					<DialogTitle className='flex items-center gap-2'>
						{isGitlab ? <GitlabIcon className='size-5' /> : <Github className='size-5' />}
						{isGitlab ? 'Select GitLab project' : 'Select repository'}
					</DialogTitle>
					<DialogDescription>
						Pull requests with drafted context changes will be opened against this{' '}
						{isGitlab ? 'project' : 'repository'}.
					</DialogDescription>
				</DialogHeader>

				{isGitlab ? (
					<GitlabRepoList
						selected={selected}
						onSelect={(name) => setSelected(name === selected ? null : name)}
					/>
				) : (
					<GithubRepoList
						selected={selected}
						onSelect={(name) => setSelected(name === selected ? null : name)}
					/>
				)}

				{error && <p className='text-sm text-destructive'>{error}</p>}

				<DialogFooter>
					<Button variant='outline' className='rounded-full border' onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						variant='primary-gradient'
						className='rounded-full'
						onClick={() => selected && onConfirm(selected)}
						disabled={!selected || isPending}
					>
						{isPending && <Spinner className='size-4' />}
						Use {isGitlab ? 'project' : 'repository'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
