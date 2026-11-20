import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, FilePen, FolderGit2, GitBranch } from 'lucide-react';

import type { FileExplorerWorktree } from '@/contexts/file-explorer-worktree';
import { BranchPicker } from '@/components/settings/branch-picker';
import { getBranchChangeReason, RepositoryBranchList } from '@/components/settings/repository-branch-menu';
import { BranchCode } from '@/components/settings/test-run-labels';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useFileExplorerWorktree } from '@/contexts/file-explorer-worktree';
import { useContextChanges } from '@/hooks/use-context-changes';
import { formatUpstreamRef, useUpstreamTestSource } from '@/hooks/use-upstream-test-source';
import { invalidateExplorerQueries } from '@/lib/context-explorer-queries';
import { trpc } from '@/main';

/**
 * Picks which changes runs test against production: the user's File Explorer changes, on whichever branch of the
 * context repository the File Explorer shows, or a branch of a repository that `nao sync` copies into the context.
 */
export function TestUpstreamPicker({ disabled }: { disabled?: boolean }) {
	const repos = useQuery(trpc.testRun.listUpstreamRepos.queryOptions());
	const [source, setSource] = useUpstreamTestSource();
	const [isOpen, setIsOpen] = useState(false);
	const worktree = useFileExplorerWorktree();
	const repositoryStatus = useQuery({
		...trpc.contextExplorer.getRepositoryStatus.queryOptions(),
		staleTime: 30_000,
		enabled: worktree !== null,
	});
	const contextBranches =
		repositoryStatus.data?.gitUnavailableReason === null ? repositoryStatus.data.branches : null;
	const hasSyncedRepos = (repos.data?.length ?? 0) > 0;

	if (!hasSyncedRepos && !(worktree && contextBranches)) {
		return null;
	}

	return (
		<DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
			<DropdownMenuTrigger asChild>
				<Button
					type='button'
					size='pill'
					variant='secondary'
					className='max-w-56'
					disabled={disabled}
					aria-label='Changes to test against production'
				>
					{source ? <GitBranch className='size-3.5' /> : <FilePen className='size-3.5' />}
					<span className='truncate'>
						{source ? <BranchCode name={formatUpstreamRef(source)} /> : 'Your changes'}
					</span>
					<ChevronDown className='size-3.5 text-muted-foreground' />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-64 text-xs'>
				<DropdownMenuItem onSelect={() => setSource(null)}>
					<FilePen className='size-3.5' />
					<span className='flex-1'>Your File Explorer changes</span>
					{!source && <Check className='size-3.5' />}
				</DropdownMenuItem>
				{worktree && contextBranches && (
					<FileExplorerBranchSub
						worktree={worktree}
						currentBranch={contextBranches.currentBranch}
						defaultBranch={contextBranches.defaultBranch}
						onSwitched={() => {
							setSource(null);
							setIsOpen(false);
						}}
					/>
				)}
				{hasSyncedRepos && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuLabel className='text-[11px]'>A branch of a synced repo</DropdownMenuLabel>
					</>
				)}
				{repos.data?.map((repo) => {
					const pickedBranch = source?.repo === repo.name ? source.branch : null;
					return (
						<DropdownMenuSub key={repo.name}>
							<DropdownMenuSubTrigger className='font-normal'>
								<FolderGit2 className='size-3.5' />
								<span className='min-w-0 flex-1 truncate'>{repo.name}</span>
								{pickedBranch && (
									<span className='max-w-24 truncate font-mono text-[10.5px] text-muted-foreground'>
										{pickedBranch}
									</span>
								)}
							</DropdownMenuSubTrigger>
							<DropdownMenuSubContent className='w-80 max-w-[calc(100vw-2rem)] p-0'>
								<UpstreamBranchPicker
									repo={repo.name}
									productionBranch={repo.branch}
									selectedBranch={pickedBranch ?? repo.branch}
									onSelect={(branch) => {
										setSource(branch === repo.branch ? null : { repo: repo.name, branch });
										setIsOpen(false);
									}}
								/>
							</DropdownMenuSubContent>
						</DropdownMenuSub>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * Switches the File Explorer to another branch of the context repository, so the runs test that branch's content.
 * Production stays on its own branch.
 */
function FileExplorerBranchSub({
	worktree,
	currentBranch,
	defaultBranch,
	onSwitched,
}: {
	worktree: FileExplorerWorktree;
	currentBranch: string | null;
	defaultBranch: string;
	onSwitched: () => void;
}) {
	const queryClient = useQueryClient();
	const { changedFiles } = useContextChanges();
	const switchBranch = useMutation(
		trpc.contextExplorer.switchBranch.mutationOptions({
			onSuccess: async () => {
				await invalidateExplorerQueries(queryClient);
				worktree.onRepositoryChanged();
				onSwitched();
			},
		}),
	);
	const blockedReason = getBranchChangeReason({
		hasUnsavedFileChanges: worktree.hasUnsavedFileChanges,
		isLoading: changedFiles.isLoading,
		isError: changedFiles.isError,
		hasUncommittedChanges: (changedFiles.data?.length ?? 0) > 0,
	});

	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger className='font-normal'>
				{switchBranch.isPending ? <Spinner className='size-3.5' /> : <GitBranch className='size-3.5' />}
				<span className='flex-1'>File Explorer branch</span>
				<span className='max-w-24 truncate font-mono text-[10.5px] text-muted-foreground'>
					{currentBranch ?? 'detached'}
				</span>
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent className='w-80 max-w-[calc(100vw-2rem)] p-0'>
				<RepositoryBranchList
					currentBranch={currentBranch}
					defaultBranch={defaultBranch}
					disabledReason={switchBranch.isPending ? 'Switching the File Explorer…' : blockedReason}
					pendingBranch={switchBranch.isPending ? switchBranch.variables.branch : null}
					switchError={switchBranch.error?.message}
					onSwitch={(branch) => {
						if (branch === currentBranch) {
							onSwitched();
						} else {
							switchBranch.mutate({ branch });
						}
					}}
				/>
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}

/** The branches of one synced repository, fetched each time it opens so new branches show up right away. */
export function UpstreamBranchPicker({
	repo,
	productionBranch,
	selectedBranch,
	onSelect,
}: {
	repo: string;
	productionBranch: string | null;
	selectedBranch: string | null;
	onSelect: (branch: string) => void;
}) {
	const branches = useQuery({ ...trpc.testRun.listUpstreamBranches.queryOptions({ repo }), staleTime: 0 });
	return (
		<BranchPicker
			branches={branches.data}
			isLoading={branches.isPending}
			error={branches.error?.message ?? null}
			selectedBranch={selectedBranch}
			pinnedBranch={productionBranch ? { name: productionBranch, label: 'production' } : null}
			onRetry={() => branches.refetch()}
			onSelect={onSelect}
		/>
	);
}
