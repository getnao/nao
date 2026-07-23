import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { StoryQuerySqlSource } from '@/contexts/story-query-sql';

import { SqlQueryDisplay } from '@/components/tool-calls/sql-query-display';
import { trpc } from '@/main';

export function StoryChartQueryView({ queryId, source }: { queryId: string; source: StoryQuerySqlSource }) {
	const ownedQuery = useQuery({
		...trpc.story.getQuerySql.queryOptions({
			chatId: source.api.kind === 'owned' ? source.api.chatId : '',
			storySlug: source.api.kind === 'owned' ? source.api.storySlug : '',
			queryId,
			selections: source.selections,
		}),
		enabled: source.api.kind === 'owned',
	});

	const sharedQuery = useQuery({
		...trpc.storyShare.getQuerySql.queryOptions({
			shareId: source.api.kind === 'shared' ? source.api.shareId : '',
			queryId,
			selections: source.selections,
		}),
		enabled: source.api.kind === 'shared',
	});

	const query = source.api.kind === 'shared' ? sharedQuery : ownedQuery;
	const data = query.data;

	if (query.isLoading) {
		return (
			<div className='flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground'>
				<Loader2 className='size-4 animate-spin' />
				Loading query…
			</div>
		);
	}

	if (query.isError || !data) {
		return (
			<div className='rounded-lg border border-dashed p-4 text-sm text-muted-foreground'>
				{query.error?.message ?? 'Query unavailable'}
			</div>
		);
	}

	const showBoth = data.sqlQuery.trim() !== data.renderedSql.trim();

	return (
		<div className='flex flex-col gap-4 rounded-lg border bg-muted/20 p-3'>
			{showBoth ? (
				<>
					<section className='flex flex-col gap-1'>
						<h4 className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
							Template query
						</h4>
						<SqlQueryDisplay query={data.sqlQuery} />
					</section>
					<section className='flex flex-col gap-1'>
						<h4 className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
							Rendered query
						</h4>
						<SqlQueryDisplay query={data.renderedSql} />
					</section>
				</>
			) : (
				<section className='flex flex-col gap-1'>
					<h4 className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>Query</h4>
					<SqlQueryDisplay query={data.renderedSql} />
				</section>
			)}
		</div>
	);
}
