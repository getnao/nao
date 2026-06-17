import { useState } from 'react';
import { Streamdown } from 'streamdown';
import { Code, Copy, Table as TableIcon } from 'lucide-react';
import { ToolCallWrapper } from './tool-call-wrapper';
import { TableDisplay } from './display-table';
import type { ToolCallComponentProps } from '.';
import { useToolCallContext } from '@/contexts/tool-call';

type ViewMode = 'results' | 'query';

interface QueryAppDbInput {
	sql?: string;
}

interface QueryAppDbOutput {
	columns: string[];
	rows: Record<string, unknown>[];
	rowCount: number;
}

export const QueryAppDbToolCall = ({ toolPart }: ToolCallComponentProps) => {
	const [viewMode, setViewMode] = useState<ViewMode>('results');
	const { isSettled } = useToolCallContext();

	const input = toolPart.input as QueryAppDbInput | undefined;
	const output = toolPart.output as QueryAppDbOutput | undefined;

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
				navigator.clipboard.writeText(input?.sql ?? '');
			},
		},
	];

	return (
		<ToolCallWrapper
			defaultExpanded={false}
			overrideError={viewMode === 'query'}
			title={
				<span>
					SQL <span className='text-xs font-normal truncate'>{input?.sql}</span>
				</span>
			}
			badge={output ? `${output.rowCount} rows` : undefined}
			actions={isSettled ? actions : []}
		>
			{viewMode === 'query' && input?.sql ? (
				<div className='overflow-auto max-h-80 hide-code-header'>
					<Streamdown mode='static' controls={{ code: false }}>
						{`\`\`\`sql\n${input.sql}\n\`\`\``}
					</Streamdown>
				</div>
			) : output ? (
				<TableDisplay
					data={output.rows}
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
