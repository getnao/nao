import { ToolCallWrapper } from './tool-call-wrapper';
import type { ToolCallComponentProps } from '.';
import { useToolCallContext } from '@/contexts/tool-call';

export const ReadToolCall = ({ toolPart: { output, input } }: ToolCallComponentProps<'read'>) => {
	const { isSettled } = useToolCallContext();

	const fileName = input?.file_path?.split('/').pop() ?? input?.file_path;

	if (!isSettled) {
		return (
			<ToolCallWrapper
				title={
					<>
						Reading... <code className='text-xs bg-background/50 px-1 py-0.5 rounded'>{fileName}</code>
					</>
				}
			/>
		);
	}

	return (
		<ToolCallWrapper
			title={
				<>
					Read <code className='text-xs bg-background/50 px-1 py-0.5 rounded'>{fileName}</code>
				</>
			}
			badge={output && `(${output.numberOfTotalLines} lines)`}
		>
			{output && (
				<>
					{input?.file_path && (
						<div className='px-3 py-2 border-b border-foreground/10 bg-foreground/[0.02]'>
							<span className='text-[11px] text-foreground/40 font-mono break-all leading-relaxed'>
								{input.file_path}
							</span>
						</div>
					)}
					<div className='overflow-auto max-h-80'>
						<pre className='m-0 p-2 text-xs font-mono leading-relaxed'>{output.content}</pre>
					</div>
				</>
			)}
		</ToolCallWrapper>
	);
};
