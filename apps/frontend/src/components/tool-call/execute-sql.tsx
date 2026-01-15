import { useState } from 'react';
import { Code, Table } from 'lucide-react';
import { ToolCallProvider, useToolCallContext } from './context';
import { ToolCallWrapper } from './tool-call-wrapper';
import type { ToolCallProps } from './context';
import type { executeSqlSchemas } from 'backend/tools';
import { isToolSettled } from '@/lib/ai';

type ViewMode = 'results' | 'query';

const ExecuteSqlContent = () => {
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
	];

	return (
		<ToolCallWrapper
			bordered
			defaultExpanded
			title={
				<span>
					{isSettled ? 'Executed' : 'Executing'}{' '}
					<span className='text-xs font-normal truncate'>{input?.sql_query}</span>
				</span>
			}
			badge={output?.row_count && `${output.row_count} rows`}
			actions={isSettled ? actions : undefined}
		>
			{viewMode === 'query' && input?.sql_query ? (
				<div className='overflow-auto max-h-80'>
					<pre className='p-3 m-0 text-sm font-mono bg-background/30'>{input.sql_query}</pre>
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

export const ExecuteSqlToolCall = ({ toolPart }: ToolCallProps) => {
	return (
		<ToolCallProvider toolPart={toolPart}>
			<ExecuteSqlContent />
		</ToolCallProvider>
	);
};
