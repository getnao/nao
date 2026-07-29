import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, FilePen, FilePlus, FileX, GitBranch, RotateCcw } from 'lucide-react';

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
import { ErrorMessage } from '@/components/ui/error-message';
import { Expandable } from '@/components/ui/expandable';
import { Spinner } from '@/components/ui/spinner';
import { useSidebarSectionOpen } from '@/hooks/use-sidebar-section-open';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

type ChangedFile = {
	path: string;
	kind: 'modified' | 'untracked' | 'deleted';
};

type ContextRepo = {
	provider: 'github' | 'gitlab';
	repoFullName: string;
	branch: string | null;
};

type OpenPullRequest = {
	url: string;
	branch: string;
};

interface ContextGitPanelProps {
	repo: ContextRepo | null;
	selectedDiffPath: string | null;
	onViewDiff: (path: string) => void;
	onDiscarded: (path: string) => Promise<void>;
}

export function ContextGitPanel({ repo, selectedDiffPath, onViewDiff, onDiscarded }: ContextGitPanelProps) {
	const queryClient = useQueryClient();
	const { isOpen, setIsOpen } = useSidebarSectionOpen('context-explorer-git');
	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
	const [openPullRequests, setOpenPullRequests] = useState<Map<string, OpenPullRequest>>(() => new Map());
	const [latestPullRequest, setLatestPullRequest] = useState<OpenPullRequest | null>(null);
	const [discardPath, setDiscardPath] = useState<string | null>(null);
	const knownProposablePathsRef = useRef<Set<string>>(new Set());
	const changedFiles = useQuery({
		...trpc.contextExplorer.getChangedFiles.queryOptions(),
		enabled: repo !== null,
	});

	useEffect(() => {
		if (!changedFiles.data) {
			return;
		}
		const proposablePaths = new Set(
			changedFiles.data.filter((file) => isProposable(file)).map((file) => file.path),
		);
		setSelectedPaths((selected) => {
			const next = new Set([...selected].filter((path) => proposablePaths.has(path)));
			for (const path of proposablePaths) {
				if (!knownProposablePathsRef.current.has(path)) {
					next.add(path);
				}
			}
			return areSetsEqual(selected, next) ? selected : next;
		});
		knownProposablePathsRef.current = proposablePaths;
	}, [changedFiles.data]);

	const createPullRequest = useMutation(
		trpc.contextExplorer.createPullRequest.mutationOptions({
			onSuccess: (result, variables) => {
				const pullRequest = { url: result.url, branch: result.branch };
				setLatestPullRequest(pullRequest);
				setOpenPullRequests((current) => {
					const next = new Map(current);
					variables.paths.forEach((path) => next.set(path, pullRequest));
					return next;
				});
				setSelectedPaths((current) => {
					const next = new Set(current);
					variables.paths.forEach((path) => next.delete(path));
					return next;
				});
				void queryClient.invalidateQueries({
					queryKey: trpc.contextExplorer.getChangedFiles.queryKey(),
				});
			},
		}),
	);

	const discardChange = useMutation(
		trpc.contextExplorer.discardLocalChange.mutationOptions({
			onSuccess: async (_result, variables) => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.contextExplorer.getChangedFiles.queryKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.contextExplorer.getFileTree.queryKey(),
					}),
					onDiscarded(variables.path),
				]);
				setDiscardPath(null);
			},
		}),
	);

	const togglePath = (path: string) => {
		setSelectedPaths((current) => {
			const next = new Set(current);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	};

	const handleViewDiff = (file: ChangedFile) => {
		if (isProposable(file)) {
			setSelectedPaths((current) => (current.has(file.path) ? current : new Set(current).add(file.path)));
		}
		onViewDiff(file.path);
	};

	const handleOpenDiscard = (path: string) => {
		discardChange.reset();
		setDiscardPath(path);
	};

	const changeCount = changedFiles.data?.length ?? 0;
	const proposableCount = changedFiles.data?.filter((file) => isProposable(file)).length ?? 0;
	const selectedProposablePaths =
		changedFiles.data
			?.filter((file) => isProposable(file) && selectedPaths.has(file.path))
			.map((file) => file.path) ?? [];

	return (
		<div className='max-h-[55%] shrink-0 overflow-auto border-t bg-card p-2'>
			<Expandable
				title={
					<span className='flex items-center gap-2'>
						<GitBranch className='size-3.5' />
						Git
					</span>
				}
				badge={changeCount}
				expanded={isOpen}
				onExpandedChange={setIsOpen}
				variant='bordered'
				isLoading={changedFiles.isLoading}
			>
				<div className='flex max-h-[min(26rem,50vh)] min-h-0 flex-col'>
					{repo === null ? (
						<ConnectRepositoryMessage />
					) : changedFiles.isLoading ? (
						<div className='flex items-center justify-center py-6'>
							<Spinner />
						</div>
					) : changedFiles.isError ? (
						<div className='flex flex-col gap-2 p-3'>
							<ErrorMessage message={changedFiles.error.message || 'Failed to load changes'} />
							<Button variant='outline' size='sm' onClick={() => changedFiles.refetch()}>
								Retry
							</Button>
						</div>
					) : changeCount === 0 ? (
						<p className='p-3 text-xs text-muted-foreground'>No saved changes to propose.</p>
					) : (
						<>
							<div className='min-h-0 flex-1 overflow-y-auto p-1'>
								{changedFiles.data?.map((file) => (
									<ChangedFileRow
										key={file.path}
										file={file}
										isSelected={selectedPaths.has(file.path)}
										isViewing={selectedDiffPath === file.path}
										openPullRequest={openPullRequests.get(file.path)}
										onView={() => handleViewDiff(file)}
										onToggle={isProposable(file) ? () => togglePath(file.path) : undefined}
										onDiscard={
											file.kind === 'untracked' ? undefined : () => handleOpenDiscard(file.path)
										}
									/>
								))}
							</div>
							<div className='flex shrink-0 flex-col gap-2 border-t p-2'>
								{createPullRequest.error?.message && (
									<ErrorMessage message={createPullRequest.error.message} />
								)}
								{latestPullRequest && (
									<a
										href={latestPullRequest.url}
										target='_blank'
										rel='noreferrer'
										className='flex items-center gap-1 text-xs text-primary hover:underline'
									>
										Proposal opened
										<ExternalLink className='size-3' />
									</a>
								)}
								{proposableCount === 0 && (
									<p className='text-xs text-muted-foreground'>
										Only edits to files stored in the connected repository can be proposed.
									</p>
								)}
								<Button
									size='sm'
									className='w-full'
									disabled={selectedProposablePaths.length === 0 || createPullRequest.isPending}
									isLoading={createPullRequest.isPending}
									onClick={() => createPullRequest.mutate({ paths: selectedProposablePaths })}
								>
									{proposableCount === 0
										? 'No changes to propose'
										: `Propose ${formatSelectedCount(selectedProposablePaths.length)}`}
								</Button>
							</div>
						</>
					)}
				</div>
			</Expandable>
			<DiscardChangeDialog
				path={discardPath}
				isPending={discardChange.isPending}
				error={discardChange.error?.message}
				onOpenChange={(open) => {
					if (!open && !discardChange.isPending) {
						setDiscardPath(null);
					}
				}}
				onConfirm={() => {
					if (discardPath) {
						discardChange.mutate({ path: discardPath });
					}
				}}
			/>
		</div>
	);
}

function ChangedFileRow({
	file,
	isSelected,
	isViewing,
	openPullRequest,
	onView,
	onToggle,
	onDiscard,
}: {
	file: ChangedFile;
	isSelected: boolean;
	isViewing: boolean;
	openPullRequest: OpenPullRequest | undefined;
	onView: () => void;
	onToggle: (() => void) | undefined;
	onDiscard: (() => void) | undefined;
}) {
	const fileName = file.path.split('/').pop() ?? file.path;
	const folder = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : 'Project root';
	const change = getChangeDisplay(file.kind);
	const ChangeIcon = change.icon;

	return (
		<div className={cn('flex items-center rounded-md', isViewing && 'bg-muted')}>
			<button
				type='button'
				onClick={onView}
				className='flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/60'
			>
				<ChangeIcon className={cn('size-3.5 shrink-0', change.color)} />
				<span className='min-w-0 flex-1'>
					<span className='block truncate text-xs font-medium'>{fileName}</span>
					<span className='block truncate text-[10px] text-muted-foreground'>{folder}</span>
					{change.reason && (
						<span className='block truncate text-[10px] text-muted-foreground/70' title={change.reason}>
							{change.reason}
						</span>
					)}
				</span>
				{openPullRequest && <span className='shrink-0 text-[10px] text-primary'>Proposed</span>}
				<span className='shrink-0 text-[10px] text-muted-foreground'>{change.label}</span>
			</button>
			{openPullRequest && (
				<a
					href={openPullRequest.url}
					target='_blank'
					rel='noreferrer'
					aria-label={`Open proposal for ${fileName}`}
					title='Open proposal'
					className='flex size-7 shrink-0 items-center justify-center text-primary hover:text-primary/70'
				>
					<ExternalLink className='size-3.5' />
				</a>
			)}
			{onDiscard && (
				<button
					type='button'
					onClick={onDiscard}
					aria-label={`Undo changes to ${fileName}`}
					title='Undo changes'
					className='flex size-7 shrink-0 items-center justify-center text-muted-foreground hover:text-destructive'
				>
					<RotateCcw className='size-3.5' />
				</button>
			)}
			{onToggle && (
				<button
					type='button'
					onClick={onToggle}
					aria-pressed={isSelected}
					aria-label={`${isSelected ? 'Exclude' : 'Include'} ${fileName} in proposal`}
					className={cn(
						'mr-1 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors',
						isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/30',
					)}
				>
					{isSelected && <Check className='size-3' />}
				</button>
			)}
		</div>
	);
}

function ConnectRepositoryMessage() {
	return (
		<div className='p-3 text-xs text-muted-foreground'>
			<p>Connect a repository to review and propose changes.</p>
			<Link to='/settings/project' hash='repository' className='mt-2 inline-block text-primary hover:underline'>
				Connect a repository
			</Link>
		</div>
	);
}

function DiscardChangeDialog({
	path,
	isPending,
	error,
	onOpenChange,
	onConfirm,
}: {
	path: string | null;
	isPending: boolean;
	error: string | undefined;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
}) {
	return (
		<AlertDialog open={path !== null} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Undo changes to this file?</AlertDialogTitle>
					<AlertDialogDescription>
						This restores the saved repository version of {path?.split('/').pop()} and discards any unsaved
						edits. This cannot be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				{error && <ErrorMessage message={error} />}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isPending}>Keep changes</AlertDialogCancel>
					<AlertDialogAction
						variant='destructive'
						isLoading={isPending}
						disabled={isPending}
						onClick={(event) => {
							event.preventDefault();
							onConfirm();
						}}
					>
						Undo changes
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function getChangeDisplay(kind: ChangedFile['kind']) {
	if (kind === 'untracked') {
		return {
			icon: FilePlus,
			label: 'New',
			color: 'text-emerald-500',
			reason: "Isn't stored in the connected repository",
		};
	}
	if (kind === 'deleted') {
		return {
			icon: FileX,
			label: 'Removed',
			color: 'text-red-500',
			reason: "Removed files can't be proposed",
		};
	}
	return { icon: FilePen, label: 'Edited', color: 'text-amber-500', reason: null };
}

function isProposable(file: ChangedFile): boolean {
	return file.kind === 'modified';
}

function formatSelectedCount(count: number): string {
	return `${count} ${count === 1 ? 'change' : 'changes'}`;
}

function areSetsEqual(left: Set<string>, right: Set<string>): boolean {
	return left.size === right.size && [...left].every((value) => right.has(value));
}
