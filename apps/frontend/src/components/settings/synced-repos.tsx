import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, FolderGit2, GitBranch, GitPullRequest, Lock } from 'lucide-react';

import type { UpstreamTestSource } from '@/hooks/use-upstream-test-source';
import { ChangeRow } from '@/components/settings/changed-file-list';
import { ChangesSection, SectionNote } from '@/components/settings/changes-section';
import { TestStatusButton } from '@/components/settings/test-status-button';
import { UpstreamBranchPicker } from '@/components/settings/test-upstream-picker';
import { useUpstreamChanges } from '@/components/settings/upstream-file-diff';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { useLatestChangesRun } from '@/hooks/use-latest-changes-run';
import { formatUpstreamRef, useUpstreamTestSource } from '@/hooks/use-upstream-test-source';
import { getReviewRequestNumber } from '@/lib/review-request';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

interface SyncedReposProps {
	selectedPath: string | null;
	onViewDiff: (path: string) => void;
	onOpenTests: () => void;
}

/**
 * The repositories `nao sync` copies into the context, read-only here. Picking a branch of one lists what it changes
 * against production and makes it the branch the tests run against.
 */
export function SyncedRepos({ selectedPath, onViewDiff, onOpenTests }: SyncedReposProps) {
	const repos = useQuery(trpc.testRun.listUpstreamRepos.queryOptions());
	const [source, setSource] = useUpstreamTestSource();
	if (!repos.data?.length) {
		return null;
	}

	return (
		<ChangesSection
			title='Synced repos'
			count={repos.data.length}
			isDefaultOpen={source !== null}
			actions={
				<span title='Read-only here: change them in their repository' className='px-1 text-muted-foreground'>
					<Lock className='size-3' />
					<span className='sr-only'>Read-only</span>
				</span>
			}
		>
			{repos.data.map((repo) => {
				const pickedBranch = source?.repo === repo.name ? source.branch : null;
				return (
					<div key={repo.name} role='group' aria-label={repo.name} className='flex flex-col'>
						<SyncedRepoRow
							name={repo.name}
							productionBranch={repo.branch}
							pickedBranch={pickedBranch}
							onPickBranch={(branch) =>
								setSource(
									branch === null || branch === repo.branch ? null : { repo: repo.name, branch },
								)
							}
							onOpenTests={onOpenTests}
						/>
						{pickedBranch && (
							<div className='pl-3'>
								<UpstreamBranchChanges
									source={{ repo: repo.name, branch: pickedBranch }}
									selectedPath={selectedPath}
									onViewDiff={onViewDiff}
								/>
							</div>
						)}
					</div>
				);
			})}
		</ChangesSection>
	);
}

function SyncedRepoRow({
	name,
	productionBranch,
	pickedBranch,
	onPickBranch,
	onOpenTests,
}: {
	name: string;
	productionBranch: string | null;
	pickedBranch: string | null;
	onPickBranch: (branch: string | null) => void;
	onOpenTests: () => void;
}) {
	return (
		<>
			<div className='flex h-7 min-w-0 items-center gap-1 pr-2 pl-1.5 text-xs'>
				<FolderGit2 aria-hidden='true' className='size-3.5 shrink-0 text-muted-foreground' />
				<span className='min-w-0 flex-1 truncate font-medium' title={`repos/${name}`}>
					{name}
				</span>
				{pickedBranch && (
					<PickedBranchActions source={{ repo: name, branch: pickedBranch }} onOpenTests={onOpenTests} />
				)}
			</div>
			<div className='flex h-6 min-w-0 items-center pr-2 pl-[18px]'>
				<RepoBranchPicker
					repo={name}
					productionBranch={productionBranch}
					pickedBranch={pickedBranch}
					onPick={onPickBranch}
				/>
			</div>
		</>
	);
}

function RepoBranchPicker({
	repo,
	productionBranch,
	pickedBranch,
	onPick,
}: {
	repo: string;
	productionBranch: string | null;
	pickedBranch: string | null;
	onPick: (branch: string | null) => void;
}) {
	const [isOpen, setIsOpen] = useState(false);
	return (
		<Popover open={isOpen} onOpenChange={setIsOpen}>
			<PopoverTrigger asChild>
				<Button
					type='button'
					size='sm'
					variant='ghost'
					className={cn(
						'h-6 max-w-full min-w-0 shrink gap-1 px-1.5 text-[11px] font-normal text-muted-foreground hover:text-foreground',
						pickedBranch && 'text-foreground',
					)}
					aria-label={`Branch of ${repo}: ${pickedBranch ?? productionBranch ?? 'default'}`}
					title={
						pickedBranch
							? `Compared with ${productionBranch ?? 'the default branch'} in production`
							: 'Production'
					}
				>
					<GitBranch className='size-3 shrink-0' />
					<span className='truncate font-mono'>{pickedBranch ?? productionBranch ?? 'default'}</span>
					<ChevronDown className='size-3 shrink-0 text-muted-foreground' />
				</Button>
			</PopoverTrigger>
			<PopoverContent align='start' className='w-80 max-w-[calc(100vw-2rem)] p-0'>
				<UpstreamBranchPicker
					repo={repo}
					productionBranch={productionBranch}
					selectedBranch={pickedBranch ?? productionBranch}
					onSelect={(branch) => {
						onPick(branch);
						setIsOpen(false);
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}

function PickedBranchActions({ source, onOpenTests }: { source: UpstreamTestSource; onOpenTests: () => void }) {
	const upstreamChanges = useUpstreamChanges(source);
	const latestRun = useLatestChangesRun({
		kind: 'upstream',
		ref: formatUpstreamRef(source),
		commit: upstreamChanges.data?.commit ?? null,
	});
	const reviewRequest = upstreamChanges.data?.reviewRequest ?? null;
	if (upstreamChanges.isLoading) {
		return <Spinner className='size-3' />;
	}

	return (
		<>
			<TestStatusButton
				label='Test this branch'
				result={latestRun}
				disabled={!upstreamChanges.data?.changes.length}
				onClick={onOpenTests}
			/>
			{reviewRequest && (
				<a
					href={reviewRequest.url}
					target='_blank'
					rel='noopener noreferrer'
					title='Open the pull request of this branch'
					className='flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] transition-colors hover:bg-muted'
				>
					<GitPullRequest className='size-3 text-emerald-600 dark:text-emerald-400' />
					{getReviewRequestLabel(reviewRequest.url)}
				</a>
			)}
		</>
	);
}

function UpstreamBranchChanges({
	source,
	selectedPath,
	onViewDiff,
}: {
	source: UpstreamTestSource;
	selectedPath: string | null;
	onViewDiff: (path: string) => void;
}) {
	const upstreamChanges = useUpstreamChanges(source);
	if (upstreamChanges.isLoading) {
		return <SectionNote>Syncing the branch…</SectionNote>;
	}
	if (upstreamChanges.isError) {
		return (
			<SectionNote>
				<span className='text-destructive'>{upstreamChanges.error.message}</span>{' '}
				<button
					type='button'
					className='cursor-pointer text-foreground hover:underline'
					onClick={() => upstreamChanges.refetch()}
				>
					Retry
				</button>
			</SectionNote>
		);
	}

	const changes = upstreamChanges.data?.changes ?? [];
	if (changes.length === 0) {
		return <SectionNote>No changes vs production</SectionNote>;
	}
	return (
		<div className='flex flex-col'>
			{changes.map((change) => (
				<ChangeRow
					key={change.path}
					path={getPathInRepo(change.path, source.repo)}
					kind={change.kind}
					isViewing={change.path === selectedPath}
					onView={() => onViewDiff(change.path)}
				/>
			))}
		</div>
	);
}

function getPathInRepo(path: string, repo: string): string {
	const repoFolder = `repos/${repo}/`;
	return path.startsWith(repoFolder) ? path.slice(repoFolder.length) : path;
}

function getReviewRequestLabel(url: string): string {
	const number = getReviewRequestNumber(url);
	return number ? `#${number}` : 'Pull request';
}
