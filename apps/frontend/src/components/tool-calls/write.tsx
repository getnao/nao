import { HardDriveDownload } from 'lucide-react';
import { ToolCallWrapper } from './tool-call-wrapper';
import type { ToolCallComponentProps } from '.';
import { formatBytes } from '@/lib/utils';
import { useToolCallContext } from '@/contexts/tool-call';

export const WriteToolCall = ({ toolPart: { output, input } }: ToolCallComponentProps<'write'>) => {
	const { isSettled } = useToolCallContext();

	const filePath = output?.path ?? input?.file_path;
	const fileName = filePath?.split('/').pop() ?? filePath;

	return (
		<ToolCallWrapper
			title={
				<>
					<HardDriveDownload size={13} className='inline-block mr-1.5 -mt-0.5 text-primary-muted' />
					{isSettled ? 'Saved' : 'Saving...'}{' '}
					<code className='text-xs font-[Geist]! bg-accent/70! px-1 py-0.5 rounded'>{fileName}</code>
					{' to your files'}
				</>
			}
			badge={output && formatBytes(output.size)}
		>
			{input?.content !== undefined && (
				<div className='border rounded-lg overflow-hidden'>
					{filePath && (
						<div className='px-3 py-2 border-b text-[11px] font-mono break-all text-muted-foreground'>
							{filePath}
						</div>
					)}
					<pre className='overflow-auto max-h-80 m-0 p-3 text-xs whitespace-pre-wrap wrap-break-word'>
						{input.content}
					</pre>
				</div>
			)}
		</ToolCallWrapper>
	);
};
