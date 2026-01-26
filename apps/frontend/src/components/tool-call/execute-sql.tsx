import { useState } from 'react';
import { Streamdown } from 'streamdown';
import { Code, Copy, Table } from 'lucide-react';
import { useToolCallContext } from '../../contexts/tool-call.provider';
import { ToolCallWrapper } from './tool-call-wrapper';
import type { executeSqlSchemas } from 'backend/tools';
import { isToolSettled } from '@/lib/ai';

type ViewMode = 'results' | 'query';

export const ExecuteSqlToolCall = () => {
	const { toolPart } = useToolCallContext();
	const [viewMode, setViewMode] = useState<ViewMode>('results');
	const input = toolPart.input as executeSqlSchemas.Input | undefined;
	const output = toolPart.output as executeSqlSchemas.Output | undefined;
	const isSettled = isToolSettled(toolPart);

	const actions = [
		{
			id: 'results',
			label: <Table size={12} />,
			isActive: viewMode === 'results',
			onClick: () => setViewMode('results'),
		},
		{
			id: 'query',
			label: <Code size={12} />,
			isActive: viewMode === 'query',
			onClick: () => setViewMode('query'),
		},
		{
			id: 'copy',
			label: <Copy size={12} />,
			onClick: () => {
				navigator.clipboard.writeText(input?.sql_query ?? '');
			},
		},
	];

	return (
		<ToolCallWrapper
			defaultExpanded={false}
			overrideError={viewMode === 'query'}
			title={
				<span>
					{isSettled ? 'Executed' : 'Executing'}{' '}
					<span className='text-xs font-normal truncate'>{input?.sql_query}</span>
				</span>
			}
			badge={output?.row_count && `${output.row_count} rows`}
			actions={isSettled ? actions : []}
		>
			{viewMode === 'query' && input?.sql_query ? (
				<div className='overflow-auto max-h-80 hide-code-header'>
					<Streamdown mode='static' cdnUrl={null} controls={{ code: false }}>
						{`\`\`\`sql\n${input.sql_query}\n\`\`\``}
					</Streamdown>
				</div>
			) : output ? (
				<div className='overflow-auto max-h-80'>
					<table className='text-sm border-collapse w-full'>
						<thead>
							<tr className='border-b border-border'>
								{output.columns.map((column, i) => (
									<th
										key={i}
										className='text-left p-2.5 font-medium text-foreground/70 bg-background sticky top-0'
									>
										{column}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{output.data?.map((row, rowIndex) => (
								<tr key={rowIndex} className='border-b border-border/50 hover:bg-background/30'>
									{Object.values(row).map((value, cellIndex) => (
										<td key={cellIndex} className='p-2.5 font-mono text-xs'>
											{value === null ? (
												<span className='text-foreground/30 italic'>NULL</span>
											) : (
												String(value)
											)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
					{output.row_count === 0 && (
						<div className='p-4 text-center text-foreground/50 text-sm'>No rows returned</div>
					)}
				</div>
			) : (
				<div className='p-4 text-center text-foreground/50 text-sm'>Executing query...</div>
			)}
		</ToolCallWrapper>
	);
};
