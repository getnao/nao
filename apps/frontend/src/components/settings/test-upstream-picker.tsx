import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, FilePen, GitBranch } from 'lucide-react';

import type { UpstreamTestSource } from '@/hooks/use-upstream-test-source';
import { BranchCode } from '@/components/settings/test-run-labels';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { formatUpstreamRef, useUpstreamTestSource } from '@/hooks/use-upstream-test-source';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

/**
 * Picks which changes runs test against production: the user's File Explorer changes, or a branch of a repository
 * that `nao sync` copies into the context. Hidden when the context syncs no git repository.
 */
export function TestUpstreamPicker({ disabled }: { disabled?: boolean }) {
	const repos = useQuery(trpc.testRun.listUpstreamRepos.queryOptions());
	const [source, setSource] = useUpstreamTestSource();

	if (!repos.data?.length) {
		return null;
	}

	return (
		<DropdownMenu>
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
			<DropdownMenuContent align='end' className='max-h-96 overflow-y-auto text-xs'>
				<DropdownMenuItem onSelect={() => setSource(null)}>
					<FilePen className='size-3.5' />
					<span className='flex-1'>Your File Explorer changes</span>
					{!source && <Check className='size-3.5' />}
				</DropdownMenuItem>
				{repos.data.map((repo) => (
					<Fragment key={repo.name}>
						<DropdownMenuSeparator />
						<DropdownMenuLabel className='text-[11px]'>Branches of {repo.name}</DropdownMenuLabel>
						<UpstreamRepoBranches
							repo={repo.name}
							productionBranch={repo.branch}
							selected={source}
							onSelect={setSource}
						/>
					</Fragment>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * Lists the remote branches of one repository, its production branch first, fetched when the menu opens so new
 * branches show up right away.
 */
export function UpstreamRepoBranches({
	repo,
	productionBranch,
	selected,
	onSelect,
}: {
	repo: string;
	productionBranch: string | null;
	selected: UpstreamTestSource | null;
	onSelect: (source: UpstreamTestSource) => void;
}) {
	const branches = useQuery({ ...trpc.testRun.listUpstreamBranches.queryOptions({ repo }), staleTime: 0 });

	if (branches.isPending) {
		return (
			<div className='flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-muted-foreground'>
				<Spinner className='size-3' /> Loading branches…
			</div>
		);
	}
	if (branches.error) {
		return <div className='max-w-72 px-2 py-1.5 text-[11px] text-destructive'>{branches.error.message}</div>;
	}

	return (
		<>
			{sortProductionFirst(branches.data, productionBranch).map((branch) => {
				const isSelected = selected?.repo === repo && selected.branch === branch.name;
				return (
					<DropdownMenuItem
						key={branch.name}
						title={branch.name}
						className='gap-2 py-1.5 pr-2'
						onSelect={() => onSelect({ repo, branch: branch.name })}
					>
						<span className='min-w-0 flex-1 truncate font-mono text-[11px] font-normal'>{branch.name}</span>
						{branch.name === productionBranch && (
							<span className='shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground'>
								production
							</span>
						)}
						<Check className={cn('size-3.5', !isSelected && 'invisible')} />
					</DropdownMenuItem>
				);
			})}
		</>
	);
}

function sortProductionFirst<Branch extends { name: string }>(branches: Branch[], productionBranch: string | null) {
	return [...branches].sort(
		(left, right) => Number(right.name === productionBranch) - Number(left.name === productionBranch),
	);
}
