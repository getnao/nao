import { useQuery } from '@tanstack/react-query';
import { Funnel, FunnelX, Loader2 } from 'lucide-react';
import type { StoryQuerySqlSource } from '@/contexts/story-query-sql';
import type { StoryQueryFilterStatus } from '@/hooks/use-story-filters';

import { SemanticQueryDefinition } from '@/components/tool-calls/execute-semantic-query';
import { SqlQueryDisplay } from '@/components/tool-calls/sql-query-display';
import { Callout } from '@/components/ui/callout';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { trpc } from '@/main';
import { cn } from '@/lib/utils';

/** Tells whether the active story filters reached this chart's query. */
export function StoryQueryFilterBadge({ status }: { status: StoryQueryFilterStatus }) {
	const label = describeFilterStatus(status);
	const Icon = status.state === 'filtered' ? Funnel : FunnelX;
	return (
		<SimpleTooltip content={label}>
			<span
				aria-label={label}
				className={cn(
					'inline-flex size-6 shrink-0 items-center justify-center rounded-full',
					FILTER_STATUS_CLASS_NAMES[status.state],
				)}
			>
				<Icon className='size-3.5' />
			</span>
		</SimpleTooltip>
	);
}

export function StoryQueryFilterError({ error, onViewQuery }: { error: string; onViewQuery?: () => void }) {
	return (
		<Callout variant='destructive'>
			<div className='flex min-w-0 flex-1 flex-col gap-1'>
				<span>
					<strong className='font-semibold'>The story filters could not run on this chart.</strong> It shows
					the data saved with the story, unfiltered.
				</span>
				<code className='break-words font-mono text-[11px] opacity-90'>{error}</code>
			</div>
			{onViewQuery && (
				<button
					type='button'
					onClick={onViewQuery}
					className='shrink-0 self-start underline underline-offset-2'
				>
					View query
				</button>
			)}
		</Callout>
	);
}

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
			storyId: source.api.kind === 'shared' ? source.api.storyId : '',
			queryId,
			selections: source.selections,
		}),
		enabled: source.api.kind === 'shared',
	});

	const standaloneQuery = useQuery({
		...trpc.story.getStandaloneQuerySql.queryOptions({
			storyId: source.api.kind === 'standalone' ? source.api.storyId : '',
			queryId,
			selections: source.selections,
		}),
		enabled: source.api.kind === 'standalone',
	});

	const query = { owned: ownedQuery, shared: sharedQuery, standalone: standaloneQuery }[source.api.kind];
	const data = query.data;
	const filterStatus = source.queryFilterStatuses?.[queryId];
	const header = filterStatus?.state === 'failed' ? <StoryQueryFilterError error={filterStatus.error} /> : null;

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

	if (data.semanticQuery) {
		const savedWhereCount = data.semanticQuery.where?.length ?? 0;
		return (
			<div className='flex flex-col gap-4 rounded-lg border bg-muted/20 p-3'>
				{header}
				<section className='flex flex-col gap-1'>
					<h4 className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
						Semantic query
					</h4>
					<SemanticQueryDefinition
						query={data.effectiveSemanticQuery ?? data.semanticQuery}
						isAddedWhere={(index) => index >= savedWhereCount}
					/>
				</section>
				<section className='flex flex-col gap-1'>
					<h4 className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>Compiled SQL</h4>
					<p className='text-xs text-muted-foreground'>
						Compiled again from the current semantic layer each time the story refreshes.
					</p>
					<SqlQueryDisplay query={data.renderedSql} />
				</section>
			</div>
		);
	}

	const showBoth = data.sqlQuery.trim() !== data.renderedSql.trim();

	return (
		<div className='flex flex-col gap-4 rounded-lg border bg-muted/20 p-3'>
			{header}
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

const FILTER_STATUS_CLASS_NAMES = {
	filtered: 'bg-primary/10 text-primary',
	skipped: 'bg-amber-500/10 text-amber-500',
	failed: 'bg-destructive/10 text-destructive',
} as const;

function describeFilterStatus(status: StoryQueryFilterStatus): string {
	switch (status.state) {
		case 'filtered':
			return `Filtered by ${status.summary}`;
		case 'skipped':
			return `Not filtered by ${status.filterLabels.join(', ')}: its metrics lack that dimension`;
		case 'failed':
			return 'The story filters failed on this chart. It shows its saved data.';
	}
}
