import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Eye, GitBranch, Plus } from 'lucide-react';

import { BranchPicker } from '@/components/settings/branch-picker';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { trpc } from '@/main';

interface RepositoryBranchMenuProps {
	currentBranch: string | null;
	defaultBranch: string;
	isCurrentBranchOwned: boolean;
	disabledReason: string | null;
	/** The branch the File Explorer is switching to, while it does. */
	switchingBranch: string | null;
	onSwitch: (branch: string) => void;
	onCreate: () => void;
}

/**
 * Switches the File Explorer to any branch of the context repository, production staying on its own branch. A branch
 * of another user opens read-only.
 */
export function RepositoryBranchMenu({
	currentBranch,
	defaultBranch,
	isCurrentBranchOwned,
	disabledReason,
	switchingBranch,
	onSwitch,
	onCreate,
}: RepositoryBranchMenuProps) {
	const [isOpen, setIsOpen] = useState(false);
	return (
		<Popover open={isOpen} onOpenChange={setIsOpen}>
			<PopoverTrigger asChild>
				<Button
					variant='ghost'
					size='sm'
					className='mr-auto h-6 min-w-0 gap-1 px-1.5 text-[11.5px] font-normal'
					aria-label='Current repository branch'
					title={switchingBranch ? `Switching the File Explorer to ${switchingBranch}…` : undefined}
					disabled={switchingBranch !== null}
				>
					{switchingBranch ? (
						<>
							<Spinner aria-label='Switching branch' className='size-3 shrink-0' />
							<span className='shrink-0 text-muted-foreground'>Switching to</span>
							<span className='truncate font-mono'>{switchingBranch}</span>
						</>
					) : (
						<>
							<GitBranch className='size-3 shrink-0 text-muted-foreground' />
							<span className='truncate font-mono'>{currentBranch ?? 'Choose branch'}</span>
						</>
					)}
					{!switchingBranch && !isCurrentBranchOwned && (
						<span title='Branch of another user: read-only here' className='shrink-0'>
							<Eye aria-hidden='true' className='size-3 text-muted-foreground' />
						</span>
					)}
					<ChevronDown className='size-3 shrink-0 text-muted-foreground' />
				</Button>
			</PopoverTrigger>
			<PopoverContent align='start' className='w-80 max-w-[calc(100vw-2rem)] p-0'>
				<RepositoryBranchList
					currentBranch={currentBranch}
					defaultBranch={defaultBranch}
					disabledReason={disabledReason}
					onSwitch={(branch) => {
						setIsOpen(false);
						if (branch !== currentBranch) {
							onSwitch(branch);
						}
					}}
					onCreate={() => {
						setIsOpen(false);
						onCreate();
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}

/** The branches of the context repository, fetched each time it opens so new branches show up right away. */
export function RepositoryBranchList({
	currentBranch,
	defaultBranch,
	disabledReason,
	pendingBranch,
	switchError,
	onSwitch,
	onCreate,
}: {
	currentBranch: string | null;
	defaultBranch: string;
	disabledReason: string | null;
	pendingBranch?: string | null;
	switchError?: string;
	onSwitch: (branch: string) => void;
	onCreate?: () => void;
}) {
	const branches = useQuery({ ...trpc.contextExplorer.listBranches.queryOptions(), staleTime: 0 });
	return (
		<BranchPicker
			branches={branches.data}
			isLoading={branches.isPending}
			error={branches.error?.message ?? null}
			selectedBranch={currentBranch}
			pinnedBranch={{ name: defaultBranch, label: 'default' }}
			disabledReason={disabledReason}
			pendingBranch={pendingBranch}
			onRetry={() => branches.refetch()}
			onSelect={onSwitch}
			footer={
				(switchError || onCreate) && (
					<>
						{switchError && <p className='px-1.5 py-1 text-[11px] text-destructive'>{switchError}</p>}
						{onCreate && (
							<Button
								variant='ghost'
								size='sm'
								className='h-7 w-full justify-start gap-2 px-2 text-xs font-normal'
								disabled={disabledReason !== null}
								onClick={onCreate}
							>
								<Plus className='size-3.5' />
								New branch…
							</Button>
						)}
					</>
				)
			}
		/>
	);
}

export function getBranchChangeReason({
	hasUnsavedFileChanges,
	isLoading,
	isError,
	hasUncommittedChanges,
}: {
	hasUnsavedFileChanges: boolean;
	isLoading: boolean;
	isError: boolean;
	hasUncommittedChanges: boolean;
}): string | null {
	if (hasUnsavedFileChanges) {
		return 'Save or discard the open file before changing branches.';
	}
	if (isLoading) {
		return 'Checking for uncommitted changes before changing branches.';
	}
	if (isError) {
		return 'Reload changed files before changing branches.';
	}
	return hasUncommittedChanges ? 'Commit or discard changes before switching branches.' : null;
}
