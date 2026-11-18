import { FilePenLine } from 'lucide-react';
import { ToolCallWrapper } from './tool-call-wrapper';
import type { ToolCallComponentProps } from '.';
import { useToolCallContext } from '@/contexts/tool-call';

export const StrReplaceToolCall = ({ toolPart: { output, input } }: ToolCallComponentProps<'str_replace'>) => {
	const { isSettled } = useToolCallContext();

	const filePath = output?.path ?? input?.file_path;
	const fileName = filePath?.split('/').pop() ?? filePath;

	return (
		<ToolCallWrapper
			title={
				<>
					<FilePenLine size={13} className='inline-block mr-1.5 -mt-0.5 text-primary-muted' />
					{isSettled ? 'Edited' : 'Editing...'}{' '}
					<code className='text-xs font-[Geist]! bg-accent/70! px-1 py-0.5 rounded'>{fileName}</code>
				</>
			}
			badge={output && formatReplacements(output.replacements)}
		>
			{input?.old_string !== undefined && (
				<div className='border rounded-lg overflow-hidden'>
					{filePath && (
						<div className='px-3 py-2 border-b text-[11px] font-mono break-all text-muted-foreground'>
							{filePath}
						</div>
					)}
					<DiffLines text={input.old_string} kind='removed' />
					{input.new_string !== undefined && <DiffLines text={input.new_string} kind='added' />}
				</div>
			)}
		</ToolCallWrapper>
	);
};

const DiffLines = ({ text, kind }: { text: string; kind: 'removed' | 'added' }) => {
	const marker = kind === 'removed' ? '-' : '+';
	const tone =
		kind === 'removed'
			? 'bg-red-500/10 text-red-700 dark:text-red-300'
			: 'bg-green-500/10 text-green-700 dark:text-green-300';

	return (
		<pre className={`overflow-auto max-h-80 m-0 p-3 text-xs whitespace-pre-wrap wrap-break-word ${tone}`}>
			{text.split('\n').map((line, index) => (
				<div key={index}>
					<span className='select-none opacity-60 mr-2'>{marker}</span>
					{line}
				</div>
			))}
		</pre>
	);
};

const formatReplacements = (count: number): string => {
	return count === 1 ? '1 replacement' : `${count} replacements`;
};
