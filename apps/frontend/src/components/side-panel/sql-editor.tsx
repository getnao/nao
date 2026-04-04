import { Editor } from '@monaco-editor/react';
import { ResizableSeparator, ResizablePanel, ResizablePanelGroup } from '../ui/resizable';
import type { executeSql } from '@nao/shared/tools';
import { TableDisplay } from '@/components/tool-calls/display-table';
import { formatSQL } from '@/lib/sql-formatter';

export const SidePanelContent = ({ input, output }: { input: executeSql.Input; output: executeSql.Output }) => {
	return (
		<ResizablePanelGroup orientation='vertical' defaultLayout={{ sql: 1 / 4, results: 1 }}>
			<ResizablePanel id='sql' minSize={100} className='relative w-full group'>
				<div className='w-full h-full overflow-auto [&_span]:font-mono pl-2'>
					<Editor
						value={formatSQL(input.sql_query, output.dialect)}
						language='sql'
						theme='light'
						options={{
							minimap: {
								enabled: false,
							},
							folding: false,
							lineNumbers: 'off',
							scrollbar: {
								horizontal: 'hidden',
								vertical: 'hidden',
							},
							scrollBeyondLastLine: false,
							padding: {
								top: 16,
								bottom: 16,
							},
							wordWrap: 'on',
						}}
					/>
				</div>
			</ResizablePanel>

			<ResizableSeparator withHandle />

			<ResizablePanel id='results' minSize={100}>
				<TableDisplay
					data={output.data as Record<string, unknown>[]}
					columns={output.columns}
					className='h-full'
					tableContainerClassName='flex-1 rounded-none border-0'
					emptyLabel='No rows returned'
					maxRowsBeforePagination={100}
				/>
			</ResizablePanel>
		</ResizablePanelGroup>
	);
};
