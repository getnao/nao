import { useState } from 'react';
import { Streamdown } from 'streamdown';
import { Code, Copy, Play, Terminal } from 'lucide-react';
import { useToolCallContext } from '../../contexts/tool-call.provider';
import { ToolCallWrapper } from './tool-call-wrapper';
import type { executePythonSchemas } from '@nao/backend/tools';
import { isToolSettled } from '@/lib/ai';

type ViewMode = 'output' | 'code';

export const ExecutePythonToolCall = () => {
	const { toolPart } = useToolCallContext();
	const [viewMode, setViewMode] = useState<ViewMode>('output');
	const input = toolPart.input as executePythonSchemas.Input | undefined;
	const output = toolPart.output as executePythonSchemas.Output | undefined;
	const isSettled = isToolSettled(toolPart);

	const actions = [
		{
			id: 'output',
			label: <Play size={12} />,
			isActive: viewMode === 'output',
			onClick: () => setViewMode('output'),
		},
		{
			id: 'code',
			label: <Code size={12} />,
			isActive: viewMode === 'code',
			onClick: () => setViewMode('code'),
		},
		{
			id: 'copy',
			label: <Copy size={12} />,
			onClick: () => {
				navigator.clipboard.writeText(input?.code ?? '');
			},
		},
	];

	const codePreview = input?.code ? (input.code.length > 50 ? `${input.code.slice(0, 50)}...` : input.code) : '';

	return (
		<ToolCallWrapper
			defaultExpanded={false}
			overrideError={viewMode === 'code'}
			title={
				<span className='flex items-center gap-1.5'>
					<Terminal size={12} className='text-yellow-500 shrink-0' />
					{isSettled ? 'Ran' : 'Running'}{' '}
					<span className='text-xs font-normal truncate font-mono opacity-70'>
						{codePreview.replace(/\n/g, ' ')}
					</span>
				</span>
			}
			actions={isSettled ? actions : []}
		>
			{viewMode === 'code' && input?.code ? (
				<div className='overflow-auto max-h-80 hide-code-header'>
					<Streamdown mode='static' cdnUrl={null} controls={{ code: false }}>
						{`\`\`\`python\n${input.code}\n\`\`\``}
					</Streamdown>
				</div>
			) : output ? (
				<div className='overflow-auto max-h-80 p-3 space-y-3'>
					{/* Output value */}
					<div>
						<pre className='font-mono text-sm bg-background/50 rounded p-2 overflow-auto'>
							{typeof output.output === 'string' ? (
								<Streamdown mode='static' cdnUrl={null} controls={{ code: false }}>
									{`\`\`\`bash\n${output.output}\n\`\`\``}
								</Streamdown>
							) : (
								JSON.stringify(output.output, null, 2)
							)}
						</pre>
					</div>
				</div>
			) : (
				<div className='p-4 text-center text-foreground/50 text-sm'>Executing Python...</div>
			)}
		</ToolCallWrapper>
	);
};
