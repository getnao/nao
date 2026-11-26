import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import type { executeSql } from '@nao/shared/tools';
import type { StoryQuerySqlSource } from '@/contexts/story-query-sql';
import type { SourceQuery } from '@/lib/execute-sql-messages';

import { StoryChartQueryView } from '@/components/side-panel/story-chart-query';
import { SemanticQueryEditor } from '@/components/side-panel/semantic-query-editor';
import { SqlQueryEditor } from '@/components/side-panel/sql-editor';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useStoryQuerySql } from '@/contexts/story-query-sql';
import { isSemanticSourceQuery } from '@/lib/execute-sql-messages';
import { cn } from '@/lib/utils';

type QueryPaneMode = 'saved' | 'run';

const QUERY_PANE_MODES = [
	{ value: 'saved', label: 'Saved query' },
	{ value: 'run', label: 'As run in story' },
] as const;

interface ChartEditorQueryPaneProps {
	sourceQuery: SourceQuery & { input: executeSql.Input };
	onOutputChange: (output: executeSql.Output) => void;
	onClose: () => void;
	className?: string;
}

/** Chart space of the chart editor while the source query is being edited. */
export function ChartEditorQueryPane({ sourceQuery, onOutputChange, onClose, className }: ChartEditorQueryPaneProps) {
	const isSemantic = isSemanticSourceQuery(sourceQuery);
	const storyQuerySql = useStoryQuerySql();
	const filteredSource = storyQuerySql?.filterSummary ? storyQuerySql : null;
	const queryId = sourceQuery.output.id;
	const [mode, setMode] = useState<QueryPaneMode>(() =>
		filteredSource?.queryFilterStatuses?.[queryId]?.state === 'failed' ? 'run' : 'saved',
	);
	const showsRun = Boolean(filteredSource && queryId) && mode === 'run';

	return (
		<div className={cn('flex min-h-0 flex-1 flex-col', className)}>
			<div className='flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4 select-none'>
				<span className='text-sm font-semibold text-foreground'>
					{isSemantic ? 'Semantic query' : 'Query editor'}
				</span>
				<Button type='button' variant='ghost' size='sm' className='h-7 rounded-full text-xs' onClick={onClose}>
					<ArrowLeft className='size-3.5' /> Back to chart
				</Button>
			</div>
			{filteredSource && queryId && (
				<StoryFiltersBar summary={filteredSource.filterSummary!} mode={mode} onModeChange={setMode} />
			)}
			<div className={cn('flex min-h-0 flex-1 flex-col', showsRun && 'hidden')}>
				{isSemantic ? (
					<SemanticQueryEditor sourceQuery={sourceQuery} editable onOutputChange={onOutputChange} />
				) : (
					<SqlQueryEditor
						input={sourceQuery.input}
						output={sourceQuery.output}
						toolCallId={sourceQuery.toolCallId}
						editable
						onOutputChange={onOutputChange}
					/>
				)}
			</div>
			{showsRun && filteredSource && queryId && <StoryRunQuery queryId={queryId} source={filteredSource} />}
		</div>
	);
}

function StoryFiltersBar({
	summary,
	mode,
	onModeChange,
}: {
	summary: string;
	mode: QueryPaneMode;
	onModeChange: (mode: QueryPaneMode) => void;
}) {
	return (
		<div className='flex shrink-0 items-center justify-between gap-3 border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground'>
			<span className='min-w-0 truncate'>
				Story filters <span className='font-medium text-foreground'>{summary}</span> are added when the story
				runs. They are not saved in the query.
			</span>
			<SegmentedControl label='Query version' options={QUERY_PANE_MODES} value={mode} onChange={onModeChange} />
		</div>
	);
}

function StoryRunQuery({ queryId, source }: { queryId: string; source: StoryQuerySqlSource }) {
	return (
		<div className='min-h-0 flex-1 overflow-auto p-4'>
			<StoryChartQueryView queryId={queryId} source={source} />
		</div>
	);
}
