import { useMemo, useState } from 'react';
import { Check, UserRound } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { RepoBranch, RepoBranchList } from '@nao/shared/types';

import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Spinner } from '@/components/ui/spinner';
import { orderBranches, searchBranches } from '@/lib/branch-search';
import { getTimeAgo } from '@/lib/time-ago';
import { cn } from '@/lib/utils';

const MAX_SHOWN_BRANCHES = 100;

export interface PinnedBranch {
	name: string;
	label: string;
}

interface BranchPickerProps {
	branches: RepoBranchList | undefined;
	isLoading: boolean;
	error: string | null;
	selectedBranch: string | null;
	/** The branch shown first with a label, such as the production or default branch. */
	pinnedBranch: PinnedBranch | null;
	disabledReason?: string | null;
	/** The branch being switched to, shown with a spinner until it is done. */
	pendingBranch?: string | null;
	onRetry: () => void;
	onSelect: (branch: string) => void;
	footer?: ReactNode;
}

/**
 * Searches the branches of a repository by name or by who last committed to them, and narrows them to the user's own
 * when the git provider tells which are theirs. Works in a popover and in a dropdown submenu alike.
 */
export function BranchPicker({
	branches,
	isLoading,
	error,
	selectedBranch,
	pinnedBranch,
	disabledReason,
	pendingBranch = null,
	onRetry,
	onSelect,
	footer,
}: BranchPickerProps) {
	const [search, setSearch] = useState('');
	const [isMineOnly, setIsMineOnly] = useState(false);
	const matchingBranches = useMemo(
		() =>
			orderBranches(
				searchBranches(branches?.branches ?? [], search, isMineOnly),
				pinnedBranch?.name ?? null,
				selectedBranch,
			),
		[branches, search, isMineOnly, pinnedBranch, selectedBranch],
	);
	const shownBranches = matchingBranches.slice(0, MAX_SHOWN_BRANCHES);

	return (
		<div className='flex flex-col' onKeyDown={keepTypingInPicker}>
			<Command shouldFilter={false} label='Search branches' className='bg-transparent'>
				<CommandInput
					value={search}
					onValueChange={setSearch}
					placeholder='Search branches or @author'
					className='h-9 text-xs'
					autoFocus
				/>
				<div className='flex items-center gap-1.5 border-b px-2 py-1.5'>
					<MineToggle
						isPressed={isMineOnly}
						isAvailable={branches?.canFilterMine ?? false}
						onToggle={() => setIsMineOnly((current) => !current)}
					/>
					{branches && (
						<span className='ml-auto text-[10.5px] text-muted-foreground'>
							{formatBranchCount(matchingBranches.length, shownBranches.length)}
						</span>
					)}
				</div>
				{disabledReason && (
					<p className='border-b px-2.5 py-1.5 text-[11px] text-muted-foreground'>{disabledReason}</p>
				)}
				<CommandList className='max-h-72'>
					<BranchPickerStatus
						isLoading={isLoading}
						error={error}
						isEmpty={!!branches && matchingBranches.length === 0}
						onRetry={onRetry}
					/>
					{shownBranches.length > 0 && (
						<CommandGroup>
							{shownBranches.map((branch) => (
								<BranchRow
									key={branch.name}
									branch={branch}
									label={branch.name === pinnedBranch?.name ? pinnedBranch.label : null}
									isSelected={branch.name === selectedBranch}
									isPending={branch.name === pendingBranch}
									disabled={!!disabledReason && branch.name !== pendingBranch}
									onSelect={() => {
										if (!pendingBranch) {
											onSelect(branch.name);
										}
									}}
								/>
							))}
						</CommandGroup>
					)}
				</CommandList>
			</Command>
			{footer && <div className='border-t p-1'>{footer}</div>}
		</div>
	);
}

function MineToggle({
	isPressed,
	isAvailable,
	onToggle,
}: {
	isPressed: boolean;
	isAvailable: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type='button'
			aria-pressed={isPressed}
			disabled={!isAvailable}
			title={
				isAvailable
					? 'Only the branches you last committed to'
					: 'Connect your own GitHub or GitLab account with access to this repository to find your branches'
			}
			onClick={onToggle}
			className={cn(
				'inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border px-2 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
				isPressed
					? 'border-transparent bg-foreground text-background'
					: 'text-muted-foreground enabled:hover:text-foreground',
			)}
		>
			<UserRound className='size-3' />
			Mine
		</button>
	);
}

function BranchPickerStatus({
	isLoading,
	error,
	isEmpty,
	onRetry,
}: {
	isLoading: boolean;
	error: string | null;
	isEmpty: boolean;
	onRetry: () => void;
}) {
	if (isLoading) {
		return (
			<div className='flex items-center gap-1.5 px-2.5 py-2 text-[11px] text-muted-foreground'>
				<Spinner className='size-3' /> Loading branches…
			</div>
		);
	}
	if (error) {
		return (
			<div className='px-2.5 py-2 text-[11px]'>
				<span className='text-destructive'>{error}</span>{' '}
				<button type='button' className='cursor-pointer hover:underline' onClick={onRetry}>
					Retry
				</button>
			</div>
		);
	}
	return isEmpty ? <p className='px-2.5 py-2 text-[11px] text-muted-foreground'>No branch matches</p> : null;
}

function BranchRow({
	branch,
	label,
	isSelected,
	isPending,
	disabled,
	onSelect,
}: {
	branch: RepoBranch;
	label: string | null;
	isSelected: boolean;
	isPending: boolean;
	disabled: boolean;
	onSelect: () => void;
}) {
	const details = formatBranchDetails(branch);
	return (
		<CommandItem
			value={branch.name}
			title={branch.name}
			disabled={disabled}
			onSelect={onSelect}
			className='items-start gap-2 py-1.5'
		>
			<div className='flex min-w-0 flex-1 flex-col'>
				<span className='flex min-w-0 items-center gap-1.5'>
					<span className='truncate font-mono text-[11px]'>{branch.name}</span>
					{label && (
						<span className='shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground'>
							{label}
						</span>
					)}
				</span>
				{details && <span className='truncate text-[10.5px] text-muted-foreground'>{details}</span>}
			</div>
			{isPending ? (
				<Spinner aria-label={`Switching to ${branch.name}`} className='mt-0.5 size-3.5 opacity-100' />
			) : (
				<Check className={cn('mt-0.5 size-3.5', !isSelected && 'invisible')} />
			)}
		</CommandItem>
	);
}

/** A dropdown menu jumps to the item starting with a typed letter, which would take the focus from the search. */
function keepTypingInPicker(event: KeyboardEvent) {
	if (event.key !== 'Escape') {
		event.stopPropagation();
	}
}

function formatBranchDetails(branch: RepoBranch): string | null {
	const author = branch.isMine ? 'You' : (branch.author?.login ?? branch.author?.name);
	const date = branch.committedAt ? getTimeAgo(Date.parse(branch.committedAt)).humanReadable : null;
	return [author, date].filter(Boolean).join(' · ') || null;
}

function formatBranchCount(matchingCount: number, shownCount: number): string {
	if (shownCount < matchingCount) {
		return `${shownCount} of ${matchingCount}, search to narrow`;
	}
	return `${matchingCount} ${matchingCount === 1 ? 'branch' : 'branches'}`;
}
