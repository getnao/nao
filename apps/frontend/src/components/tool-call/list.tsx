import { File, Folder, Link } from 'lucide-react';
import { useToolCallContext } from '../../contexts/tool-call.provider';
import { ToolCallWrapper } from './tool-call-wrapper';
import type { listSchemas } from 'backend/tools';
import { formatBytes } from '@/lib/utils';
import { isToolSettled } from '@/lib/ai';

const getIcon = (type?: string) => {
	switch (type) {
		case 'directory':
			return <Folder size={14} className='text-yellow-500' />;
		case 'symbolic_link':
			return <Link size={14} className='text-blue-400' />;
		default:
			return <File size={14} className='text-foreground/50' />;
	}
};

export const ListToolCall = () => {
	const { toolPart } = useToolCallContext();
	const output = toolPart.output as listSchemas.Output | undefined;
	const input = toolPart.input as listSchemas.Input | undefined;
	const isSettled = isToolSettled(toolPart);

	if (!isSettled) {
		return (
			<ToolCallWrapper
				title={
					<>
						Listing... <code className='text-xs bg-background/50 px-1 py-0.5 rounded'>{input?.path}</code>
					</>
				}
				children={<div className='p-4 text-center text-foreground/50 text-sm'>Listing...</div>}
			/>
		);
	}

	return (
		<ToolCallWrapper
			title={
				<>
					Listed <code className='text-xs bg-background/50 px-1 py-0.5 rounded'>{input?.path}</code>
				</>
			}
			badge={output && `(${output.length} items)`}
		>
			{output && (
				<div className='overflow-auto max-h-80'>
					<div className='flex flex-col gap-0.5 py-1'>
						{output.map((item, index) => (
							<div
								key={index}
								className='flex items-center gap-2 px-2 py-1 hover:bg-background/50 rounded text-sm'
							>
								{getIcon(item.type)}
								<span className='font-mono text-xs flex-1 truncate'>{item.name}</span>
								{item.type === 'directory' && item.itemCount !== undefined && (
									<span className='text-xs text-foreground/40'>
										{item.itemCount} {item.itemCount === 1 ? 'item' : 'items'}
									</span>
								)}
								{item.size && (
									<span className='text-xs text-foreground/40'>{formatBytes(Number(item.size))}</span>
								)}
							</div>
						))}
					</div>
					{output.length === 0 && (
						<div className='p-4 text-center text-foreground/50 text-sm'>Empty directory</div>
					)}
				</div>
			)}
		</ToolCallWrapper>
	);
};
