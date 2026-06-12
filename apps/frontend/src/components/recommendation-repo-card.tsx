import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitBranch, Github, Unlink } from 'lucide-react';
import { useState } from 'react';

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
import { SettingsCard } from '@/components/ui/settings-card';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { trpc } from '@/main';

const RETURN_TO = '/settings/recommendations';

/**
 * Surfaces the repository that gates automatic PR drafting. The project's own GitHub
 * remote is used when present; otherwise admins can pick any repository here — useful
 * when the context is deployed via `nao deploy` or a mounted volume instead of a clone.
 */
export function RecommendationRepoCard() {
	const queryClient = useQueryClient();
	const [confirmUnlink, setConfirmUnlink] = useState(false);
	const [pickerOpen, setPickerOpen] = useState(false);
	const available = useQuery(trpc.github.isAvailable.queryOptions());
	const status = useQuery({
		...trpc.github.getStatus.queryOptions(),
		enabled: available.data === true,
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

	const unlink = useMutation(
		trpc.github.unlinkProject.mutationOptions({
			onSuccess: () => {
				setConfirmUnlink(false);
				invalidateRepo();
				queryClient.invalidateQueries({ queryKey: trpc.github.getProjectGitInfo.queryKey() });
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

	if (available.data === false) {
		return null;
	}

	if (available.isLoading || status.isLoading || repo.isLoading) {
		return (
			<SettingsCard title='Repository' icon={<Github className='size-4' />}>
				<Skeleton className='h-4 w-48' />
			</SettingsCard>
		);
	}

	const connected = status.data?.connected === true;

	if (!connected) {
		return (
			<SettingsCard
				title='Repository'
				icon={<Github className='size-4' />}
				description='Connect GitHub so nao can draft pull requests that improve your context.'
			>
				<Button size='sm' asChild>
					<a href={`/api/github/connect?returnTo=${RETURN_TO}`}>
						<Github className='size-3.5' />
						Connect GitHub
					</a>
				</Button>
			</SettingsCard>
		);
	}

	if (!repo.data) {
		return (
			<SettingsCard
				title='Repository'
				icon={<Github className='size-4' />}
				description='This project is not linked to a GitHub repository. Select the repository that holds your context files so nao can open pull requests against it.'
			>
				<div className='flex flex-col gap-3'>
					<Button size='sm' onClick={() => setPickerOpen(true)} className='self-start'>
						<Github className='size-3.5' />
						Select repository
					</Button>
					<LinkedReposList repos={linkedRepos.data ?? []} />
				</div>
				<RepoPickerDialog
					open={pickerOpen}
					onOpenChange={setPickerOpen}
					onConfirm={(repoFullName) => setRepo.mutate({ repoFullName })}
					isPending={setRepo.isPending}
					error={setRepo.error?.message}
				/>
			</SettingsCard>
		);
	}

	const { repoFullName, branch, source } = repo.data;

	return (
		<SettingsCard
			title='Repository'
			icon={<Github className='size-4' />}
			description={
				source === 'project'
					? 'Connected. New high-impact recommendations include drafted changes you can open as a pull request.'
					: 'Pull requests with drafted context changes are opened against this repository. Project files are not synced from it.'
			}
		>
			<div className='flex items-center justify-between gap-2 text-sm'>
				<div className='flex items-center gap-2'>
					<a
						href={`https://github.com/${repoFullName}`}
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
						<Button size='sm' variant='outline' onClick={() => setPickerOpen(true)}>
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
				onOpenChange={setPickerOpen}
				onConfirm={(name) => setRepo.mutate({ repoFullName: name })}
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
						{repo.repoFullName ? (
							<a
								href={`https://github.com/${repo.repoFullName}`}
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
	onOpenChange: (open: boolean) => void;
	onConfirm: (repoFullName: string) => void;
	isPending: boolean;
	error?: string;
}

function RepoPickerDialog({ open, onOpenChange, onConfirm, isPending, error }: RepoPickerDialogProps) {
	const [selected, setSelected] = useState<string | null>(null);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-lg'>
				<DialogHeader>
					<DialogTitle className='flex items-center gap-2'>
						<Github className='size-5' />
						Select repository
					</DialogTitle>
					<DialogDescription>
						Pull requests with drafted context changes will be opened against this repository.
					</DialogDescription>
				</DialogHeader>

				<GithubRepoList selected={selected} onSelect={(name) => setSelected(name === selected ? null : name)} />

				{error && <p className='text-sm text-destructive'>{error}</p>}

				<DialogFooter>
					<Button variant='outline' onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={() => selected && onConfirm(selected)} disabled={!selected || isPending}>
						{isPending && <Spinner className='size-4' />}
						Use repository
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
