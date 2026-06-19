import { File, Folder, Link } from 'lucide-react';
import { ToolCallWrapper } from './tool-call-wrapper';
import type { ToolCallComponentProps } from '.';
import { formatBytes } from '@/lib/utils';
import { useToolCallContext } from '@/contexts/tool-call';

const getIcon = (type?: string) => {
	switch (type) {
		case 'directory':
			return <Folder size={14} className='text-violet shrink-0' />;
		case 'symbolic_link':
			return <Link size={14} className='text-blue-400 shrink-0' />;
		default:
			return <File size={14} className='text-primary-muted shrink-0' />;
	}
};

export const ListToolCall = ({ toolPart }: ToolCallComponentProps<'list'>) => {
	const { isSettled } = useToolCallContext();
	const output = toolPart.output;
	const input = toolPart.input;
	const entries = Array.isArray(output) ? output : output?.entries || [];

	if (!isSettled) {
		return (
			<ToolCallWrapper
				title={
					<>
						Listing...{' '}
						<code className='text-xs font-[Geist]! bg-accent/70! px-0.5 py-0.5 rounded'>{input?.path}</code>
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
					Listed{' '}
					<code className='text-xs font-[Geist]! bg-accent/70! px-1 py-0.5 rounded'>{input?.path}</code>
				</>
			}
			badge={entries && `${entries.length} items`}
		>
			{output && (
				<div className='overflow-auto max-h-80'>
					<div className='flex flex-col gap-0.5 py-1'>
						{entries.map((item, index) => (
							<div
								key={index}
								className='flex items-center gap-2 px-2 py-1 hover:bg-background/50 rounded text-sm'
							>
								{getIcon(item.type)}
								<span className='text-xs flex-1 truncate leading-none min-w-0'>{item.name}</span>
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
					{entries.length === 0 && (
						<div className='p-4 text-center text-foreground/50 text-sm'>Empty directory</div>
					)}
				</div>
			)}
		</ToolCallWrapper>
	);
};
