import { ArrowLeft } from 'lucide-react';
import type { executeSql } from '@nao/shared/tools';
import type { SourceQuery } from '@/lib/execute-sql-messages';

import { SemanticQueryEditor } from '@/components/side-panel/semantic-query-editor';
import { SqlQueryEditor } from '@/components/side-panel/sql-editor';
import { Button } from '@/components/ui/button';
import { isSemanticSourceQuery } from '@/lib/execute-sql-messages';
import { cn } from '@/lib/utils';

interface ChartEditorQueryPaneProps {
	sourceQuery: SourceQuery & { input: executeSql.Input };
	onOutputChange: (output: executeSql.Output) => void;
	onClose: () => void;
	className?: string;
}

/** Chart space of the chart editor while the source query is being edited. */
export function ChartEditorQueryPane({ sourceQuery, onOutputChange, onClose, className }: ChartEditorQueryPaneProps) {
	const isSemantic = isSemanticSourceQuery(sourceQuery);

	return (
		<div className={cn('flex min-h-0 flex-1 flex-col', className)}>
			<div className='flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4'>
				<span className='text-sm font-semibold text-foreground'>
					{isSemantic ? 'Semantic query' : 'Query editor'}
				</span>
				<Button type='button' variant='ghost' size='sm' className='h-7 rounded-full text-xs' onClick={onClose}>
					<ArrowLeft className='size-3.5' /> Back to chart
				</Button>
			</div>
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
	);
}
