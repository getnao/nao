import { ArrowLeft } from 'lucide-react';
import type { executeSql } from '@nao/shared/tools';

import { SqlQueryEditor } from '@/components/side-panel/sql-editor';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ChartEditorQueryPaneProps {
	input: executeSql.Input;
	output: executeSql.Output;
	toolCallId?: string;
	onOutputChange: (output: executeSql.Output) => void;
	onClose: () => void;
	className?: string;
}

/** Chart space of the chart editor while the source query is being edited. */
export function ChartEditorQueryPane({
	input,
	output,
	toolCallId,
	onOutputChange,
	onClose,
	className,
}: ChartEditorQueryPaneProps) {
	return (
		<div className={cn('flex min-h-0 flex-1 flex-col', className)}>
			<div className='flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4'>
				<span className='text-sm font-semibold text-foreground'>Query editor</span>
				<Button type='button' variant='ghost' size='sm' className='h-7 rounded-full text-xs' onClick={onClose}>
					<ArrowLeft className='size-3.5' /> Back to chart
				</Button>
			</div>
			<SqlQueryEditor
				input={input}
				output={output}
				toolCallId={toolCallId}
				editable
				onOutputChange={onOutputChange}
			/>
		</div>
	);
}
