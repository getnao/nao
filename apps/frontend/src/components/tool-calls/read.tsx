import { ToolCallWrapper } from './tool-call-wrapper';
import type { ToolCallComponentProps } from '.';
import { useToolCallContext } from '@/contexts/tool-call';

export const ReadToolCall = ({ toolPart: { output, input } }: ToolCallComponentProps<'read'>) => {
	const { isSettled } = useToolCallContext();

	const filePath = input?.file_path;
	const fileName = filePath?.split('/').pop() ?? filePath;
	const contextLabel = getReadContextLabel(filePath);
	const titleContext = contextLabel ? (
		<>
			{' '}
			from <code className='text-xs bg-background/50 px-1 py-0.5 rounded'>{contextLabel}</code>
		</>
	) : null;

	if (!isSettled) {
		return (
			<ToolCallWrapper
				title={
					<>
						Reading... <code className='text-xs bg-background/50 px-1 py-0.5 rounded'>{fileName}</code>
						{titleContext}
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
					{titleContext}
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

const getReadContextLabel = (filePath?: string): string | null => {
	if (!filePath) {
		return null;
	}

	const schemaMatch = filePath.match(/\/schema=([^/]+)/);
	const tableMatch = filePath.match(/\/table=([^/]+)/);
	if (schemaMatch && tableMatch) {
		return `${schemaMatch[1]}.${tableMatch[1]}`;
	}

	const pathSegments = filePath.split('/').filter(Boolean);
	if (pathSegments.length < 2) {
		return null;
	}

	const parentDir = pathSegments[pathSegments.length - 2];
	if (!parentDir || parentDir.includes('=')) {
		return null;
	}

	return parentDir;
};
