import { useState } from 'react';
import { Globe, Loader2, Lock, Search } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { formatRelativeDate } from '@/lib/time-ago';

interface RepoListPage<T> {
	items: T[];
	hasMore: boolean;
}

interface RepoListProps<T> {
	selected: string | null;
	onSelect: (value: string) => void;
	onSearchChange?: () => void;
	renderRepoMeta?: (item: T) => ReactNode;
	searchPlaceholder: string;
	resourceNounPlural: string;
	useItems: (params: { page: number; search?: string }) => { data?: RepoListPage<T>; isLoading: boolean };
	getKey: (item: T) => string | number;
	getValue: (item: T) => string;
	getLabel: (item: T) => string;
	getDescription: (item: T) => string | null | undefined;
	getUpdatedAt: (item: T) => string;
	isPrivate: (item: T) => boolean;
}

/**
 * Searchable, paginated list of a connected git provider's repos/projects. Provider-specific
 * data fetching and field access are injected via props so GitHub and GitLab can't drift.
 */
export function RepoList<T>({
	selected,
	onSelect,
	onSearchChange,
	renderRepoMeta,
	searchPlaceholder,
	resourceNounPlural,
	useItems,
	getKey,
	getValue,
	getLabel,
	getDescription,
	getUpdatedAt,
	isPrivate,
}: RepoListProps<T>) {
	const [search, setSearch] = useState('');
	const [page, setPage] = useState(1);
	const debouncedSearch = useDebouncedValue(search, 300);

	const { data, isLoading } = useItems({ page, search: debouncedSearch || undefined });

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
					placeholder={searchPlaceholder}
					value={search}
					onChange={(e) => handleSearchChange(e.target.value)}
					className='pl-9'
				/>
			</div>

			<div className='flex flex-col gap-1 max-h-[340px] overflow-y-auto -mx-1 px-1'>
				{isLoading && !data ? (
					<div className='flex items-center justify-center py-8 text-muted-foreground'>
						<Loader2 className='size-5 animate-spin' />
					</div>
				) : data?.items.length === 0 ? (
					<div className='py-8 text-center text-sm text-muted-foreground'>
						{debouncedSearch ? `No ${resourceNounPlural} found.` : `No ${resourceNounPlural} available.`}
					</div>
				) : (
					data?.items.map((item) => (
						<button
							key={getKey(item)}
							type='button'
							onClick={() => onSelect(getValue(item))}
							className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
								selected === getValue(item)
									? 'border-primary bg-primary/5'
									: 'border-transparent hover:bg-muted/50'
							}`}
						>
							<div className='mt-0.5'>
								{isPrivate(item) ? (
									<Lock className='size-4 text-muted-foreground' />
								) : (
									<Globe className='size-4 text-muted-foreground' />
								)}
							</div>
							<div className='min-w-0 flex-1'>
								<div className='text-sm font-medium truncate'>{getLabel(item)}</div>
								{getDescription(item) && (
									<div className='text-xs text-muted-foreground truncate mt-0.5'>
										{getDescription(item)}
									</div>
								)}
								<div className='text-xs text-muted-foreground mt-1'>
									Updated {formatRelativeDate(new Date(getUpdatedAt(item)))}
								</div>
								{renderRepoMeta?.(item)}
							</div>
						</button>
					))
				)}
			</div>

			{data && (data.hasMore || page > 1) && (
				<div className='flex items-center justify-between border-t pt-3'>
					<Button variant='outline' size='sm' disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
						Previous
					</Button>
					<span className='text-xs text-muted-foreground'>Page {page}</span>
					<Button variant='outline' size='sm' disabled={!data.hasMore} onClick={() => setPage((p) => p + 1)}>
						Next
					</Button>
				</div>
			)}
		</>
	);
}
