import { File } from 'lucide-react';
import { useToolCallContext } from '../../contexts/tool-call.provider';
import { ToolCallWrapper } from './tool-call-wrapper';
import type { searchFilesSchemas } from 'backend/tools';
import { formatBytes } from '@/lib/utils';
import { isToolSettled } from '@/lib/ai';

export const SearchToolCall = () => {
	const { toolPart } = useToolCallContext();
	const output = toolPart.output as searchFilesSchemas.Output | undefined;
	const input = toolPart.input as searchFilesSchemas.Input | undefined;
	const isSettled = isToolSettled(toolPart);

	if (!isSettled) {
		return (
			<ToolCallWrapper
				title={
					<>
						Searching <code className='text-xs bg-background/50 px-1 py-0.5 rounded'>{input?.pattern}</code>
					</>
				}
				children={<div className='p-4 text-center text-foreground/50 text-sm'>Searching...</div>}
			/>
		);
	}

	return (
		<ToolCallWrapper
			title={
				<>
					Searched <code className='text-xs bg-background/50 px-1 py-0.5 rounded'>{input?.pattern}</code>
				</>
			}
			badge={output && `(${output.length} matches)`}
		>
			{output && (
				<div className='overflow-auto max-h-80'>
					<div className='flex flex-col gap-0.5 py-1'>
						{output.map((item, index) => (
							<div
								key={index}
								className='flex items-center gap-2 px-2 py-1 hover:bg-background/50 rounded text-sm'
							>
								<File size={14} className='text-foreground/50 shrink-0' />
								<div className='flex-1 min-w-0 flex flex-col'>
									<span className='font-mono text-xs truncate'>{item.path}</span>
								</div>
								{item.size && (
									<span className='text-xs text-foreground/40 shrink-0'>
										{formatBytes(Number(item.size))}
									</span>
								)}
							</div>
						))}
					</div>
					{output.length === 0 && (
						<div className='p-4 text-center text-foreground/50 text-sm'>No files found</div>
					)}
				</div>
			)}
		</ToolCallWrapper>
	);
};
