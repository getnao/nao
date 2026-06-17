import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Globe, Loader2, Lock, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import type { inferRouterOutputs } from '@trpc/server';

import type { TrpcRouter } from '@nao/backend/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { formatRelativeDate } from '@/lib/time-ago';
import { trpc } from '@/main';

export type GithubRepo = inferRouterOutputs<TrpcRouter>['github']['listRepos']['repos'][number];

interface GithubRepoListProps {
	selected: string | null;
	onSelect: (repoFullName: string) => void;
	onSearchChange?: () => void;
	renderRepoMeta?: (repo: GithubRepo) => ReactNode;
}

/** Searchable, paginated list of the connected user's GitHub repositories. */
export function GithubRepoList({ selected, onSelect, onSearchChange, renderRepoMeta }: GithubRepoListProps) {
	const [search, setSearch] = useState('');
	const [page, setPage] = useState(1);
	const debouncedSearch = useDebouncedValue(search, 300);

	const repos = useQuery({
		...trpc.github.listRepos.queryOptions({ page, search: debouncedSearch || undefined }),
		placeholderData: (prev) => prev,
	});

	const handleSearchChange = (value: string) => {
		onSearchChange?.();
		setSearch(value);
		setPage(1);
	};

	return (
		<>
			<div className='relative'>
				<Search className='absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
				<Input
					placeholder='Search repositories...'
					value={search}
					onChange={(e) => handleSearchChange(e.target.value)}
					className='pl-9'
				/>
			</div>

			<div className='flex flex-col gap-1 max-h-[340px] overflow-y-auto -mx-1 px-1'>
				{repos.isLoading && !repos.data ? (
					<div className='flex items-center justify-center py-8 text-muted-foreground'>
						<Loader2 className='size-5 animate-spin' />
					</div>
				) : repos.data?.repos.length === 0 ? (
					<div className='py-8 text-center text-sm text-muted-foreground'>
						{debouncedSearch ? 'No repositories found.' : 'No repositories available.'}
					</div>
				) : (
					repos.data?.repos.map((repo) => (
						<button
							key={repo.id}
							type='button'
							onClick={() => onSelect(repo.full_name)}
							className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
								selected === repo.full_name
									? 'border-primary bg-primary/5'
									: 'border-transparent hover:bg-muted/50'
							}`}
						>
							<div className='mt-0.5'>
								{repo.private ? (
									<Lock className='size-4 text-muted-foreground' />
								) : (
									<Globe className='size-4 text-muted-foreground' />
								)}
							</div>
							<div className='min-w-0 flex-1'>
								<div className='text-sm font-medium truncate'>{repo.full_name}</div>
								{repo.description && (
									<div className='text-xs text-muted-foreground truncate mt-0.5'>
										{repo.description}
									</div>
								)}
								<div className='text-xs text-muted-foreground mt-1'>
									Updated {formatRelativeDate(new Date(repo.updated_at))}
								</div>
								{renderRepoMeta?.(repo)}
							</div>
						</button>
					))
				)}
			</div>

			{repos.data && (repos.data.hasMore || page > 1) && (
				<div className='flex items-center justify-between border-t pt-3'>
					<Button variant='outline' size='sm' disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
						Previous
					</Button>
					<span className='text-xs text-muted-foreground'>Page {page}</span>
					<Button
						variant='outline'
						size='sm'
						disabled={!repos.data.hasMore}
						onClick={() => setPage((p) => p + 1)}
					>
						Next
					</Button>
				</div>
			)}
		</>
	);
}
