import { useState } from 'react';
import { Streamdown } from 'streamdown';
import { ArrowUpRight, Code, Copy, Table as TableIcon } from 'lucide-react';
import { ToolCallWrapper } from './tool-call-wrapper';
import { TableDisplay } from './display-table';
import type { ToolCallComponentProps } from '.';
import { useSidePanel } from '@/contexts/side-panel';
import { useToolCallContext } from '@/contexts/tool-call';
import { SidePanelContent } from '@/components/side-panel/sql-editor';

type ViewMode = 'results' | 'query';

export const ExecuteSqlToolCall = ({ toolPart: { output, input, state } }: ToolCallComponentProps<'execute_sql'>) => {
	const [viewMode, setViewMode] = useState<ViewMode>('results');
	const { isSettled } = useToolCallContext();
	const { open: openSidePanel } = useSidePanel();

	const actions = [
		{
			id: 'results',
			label: <TableIcon className='size-3' />,
			expandOnClick: true,
			isActive: viewMode === 'results',
			onClick: () => setViewMode('results'),
		},
		{
			id: 'query',
			label: <Code className='size-3' />,
			expandOnClick: true,
			isActive: viewMode === 'query',
			onClick: () => setViewMode('query'),
		},
		{
			id: 'copy',
			label: <Copy className='size-3' />,
			onClick: () => {
				navigator.clipboard.writeText(input?.sql_query ?? '');
			},
		},
		{
			id: 'expand',
			label: <ArrowUpRight className='size-3' />,
			onClick: () => {
				if (state === 'input-streaming' || !output || !input) {
					return;
				}
				openSidePanel(<SidePanelContent input={input} output={output} />);
			},
		},
	];

	return (
		<ToolCallWrapper
			defaultExpanded={false}
			overrideError={viewMode === 'query'}
			title={
				<span>
					SQL <span className='text-xs font-normal truncate'>{input?.name ?? input?.sql_query}</span>
				</span>
			}
			badge={output?.row_count && `${output.row_count} rows`}
			actions={isSettled ? actions : []}
		>
			{viewMode === 'query' && input?.sql_query ? (
				<div className='overflow-auto max-h-80 hide-code-header'>
					<Streamdown mode='static' controls={{ code: false }}>
						{`\`\`\`sql\n${input.sql_query}\n\`\`\``}
					</Streamdown>
				</div>
			) : output ? (
				<TableDisplay
					data={output.data as Record<string, unknown>[]}
					columns={output.columns}
					tableContainerClassName='max-h-80 rounded-none border-0 bg-transparent'
					showRowCount={false}
				/>
			) : (
				<div className='p-4 text-center text-foreground/50 text-sm'>Executing query...</div>
			)}
		</ToolCallWrapper>
	);
};
