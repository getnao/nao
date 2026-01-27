import { useToolCallContext } from '../../contexts/tool-call.provider';
import { ToolCallWrapper } from './tool-call-wrapper';
import type { readFileSchemas } from 'backend/tools';
import { isToolSettled } from '@/lib/ai';

export const ReadToolCall = () => {
	const { toolPart } = useToolCallContext();
	const output = toolPart.output as readFileSchemas.Output | undefined;
	const input = toolPart.input as readFileSchemas.Input | undefined;
	const isSettled = isToolSettled(toolPart);

	const fileName = input?.file_path?.split('/').pop() ?? input?.file_path;

	if (!isSettled) {
		return (
			<ToolCallWrapper
				title={
					<>
						Reading... <code className='text-xs bg-background/50 px-1 py-0.5 rounded'>{fileName}</code>
					</>
				}
				children={<div className='p-4 text-center text-foreground/50 text-sm'>Reading file...</div>}
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
