import { useState } from 'react';
import { Streamdown } from 'streamdown';
import { Code, Copy, Terminal } from 'lucide-react';
import { useToolCallContext } from '../../contexts/tool-call.provider';
import { ToolCallWrapper } from './tool-call-wrapper';
import type { executePython } from '@nao/shared/tools';
import { isToolSettled } from '@/lib/ai';

type ViewMode = 'output' | 'code';

const formatOutput = (value: unknown): string => {
	if (value === null) {
		return 'null';
	}
	if (value === undefined) {
		return 'undefined';
	}
	if (typeof value === 'object') {
		return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
	}
	return `\`\`\`bash\n${String(value)}\n\`\`\``;
};

export const ExecutePythonToolCall = () => {
	const { toolPart } = useToolCallContext();
	const [viewMode, setViewMode] = useState<ViewMode>('output');
	const input = toolPart.input as executePython.Input | undefined;
	const output = toolPart.output as executePython.Output | undefined;
	const isSettled = isToolSettled(toolPart);

	const actions = [
		{
			id: 'output',
			label: <Terminal size={12} />,
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
				<span>
					{isSettled ? 'Ran Python' : 'Running Python'}{' '}
					<span className='text-xs font-normal truncate'>{codePreview.replace(/\n/g, ' ')}</span>
				</span>
			}
			actions={isSettled ? actions : []}
		>
			{viewMode === 'code' && input?.code ? (
				<div className='overflow-auto max-h-80 hide-code-header'>
					<Streamdown mode='static' controls={{ code: false }}>
						{`\`\`\`python\n${input.code}\n\`\`\``}
					</Streamdown>
				</div>
			) : output ? (
				<div className='overflow-auto max-h-80'>
					{/* Output value */}
					<div>
						<pre className='font-mono text-sm rounded overflow-auto hide-code-header'>
							<Streamdown mode='static' controls={{ code: false }}>
								{formatOutput(output.output)}
							</Streamdown>
						</pre>
					</div>
				</div>
			) : (
				<div className='p-4 text-center text-foreground/50 text-sm'>Executing Python...</div>
			)}
		</ToolCallWrapper>
	);
};
