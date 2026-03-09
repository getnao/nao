import { useState } from 'react';
import { Streamdown } from 'streamdown';
import { executeSandboxedCode } from '@nao/shared/tools';
import { Box, Code, Copy, Cpu, Database, Package, Terminal } from 'lucide-react';
import { ToolCallWrapper } from './tool-call-wrapper';
import type { ToolCallComponentProps } from '.';
import { useToolCallContext } from '@/contexts/tool-call';
import { cn } from '@/lib/utils';

type ViewMode = 'output' | 'code';

export const ExecuteSandboxedCodeToolCall = ({
	toolPart: { output, input },
}: ToolCallComponentProps<'execute_sandboxed_code'>) => {
	const [viewMode, setViewMode] = useState<ViewMode>('output');
	const { isSettled } = useToolCallContext();

	const language = input?.language ?? 'python';
	const exitCode = output?.exitCode ?? null;
	const hasError = exitCode !== null && exitCode !== 0;
	const packages = input?.packages;
	const dataFiles = input?.data_files;

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

	const vmSize = input?.vm_size ?? 'xxs';
	const vmSpecs = executeSandboxedCode.VM_SIZE_SPECS[vmSize];
	const sandboxId = output?.sandbox_id;

	const setupInfo = [
		...(packages?.length ? [`${packages.length} pkg${packages.length > 1 ? 's' : ''}`] : []),
		...(dataFiles?.length ? [`${dataFiles.length} file${dataFiles.length > 1 ? 's' : ''}`] : []),
	].join(', ');

	return (
		<ToolCallWrapper
			defaultExpanded={false}
			overrideError={viewMode === 'code'}
			title={
				<span className='flex items-center gap-1.5'>
					<Box size={12} className='shrink-0 opacity-60' />
					{isSettled ? 'Ran' : 'Running'} {language}{' '}
					<span className='text-xs font-normal truncate'>{codePreview.replace(/\n/g, ' ')}</span>
				</span>
			}
			badge={
				isSettled && exitCode !== null ? (
					<span className={cn(hasError ? 'text-red-400' : 'text-green-400')}>exit {exitCode}</span>
				) : undefined
			}
			actions={isSettled ? actions : []}
		>
			{viewMode === 'code' ? (
				<div className='overflow-auto max-h-80'>
					{!!(packages?.length || dataFiles?.length) && (
						<div className='flex flex-wrap gap-2 px-3 py-2 border-b border-border text-xs text-foreground/60'>
							{!!packages?.length && (
								<span className='flex items-center gap-1'>
									<Package size={10} />
									{packages.join(', ')}
								</span>
							)}
							{!!dataFiles?.length && (
								<span className='flex items-center gap-1'>
									<Database size={10} />
									{dataFiles.map((f) => f?.filename).join(', ')}
								</span>
							)}
						</div>
					)}
					{input?.code && (
						<div className='hide-code-header'>
							<Streamdown mode='static' controls={{ code: false }}>
								{`\`\`\`${language}\n${input.code}\n\`\`\``}
							</Streamdown>
						</div>
					)}
				</div>
			) : output ? (
				<div className='overflow-auto max-h-80'>
					{(setupInfo || sandboxId) && (
						<div className='flex items-center gap-3 px-3 py-1.5 border-b border-border text-xs text-foreground/50'>
							{setupInfo && <span>{setupInfo}</span>}
							<span className='flex items-center gap-1'>
								<Cpu size={10} />
								{vmSize.toUpperCase()} · {vmSpecs.memoryMib}MB · {vmSpecs.cpus}cpu
							</span>
							{sandboxId && (
								<span className='ml-auto font-mono truncate max-w-[180px]' title={sandboxId}>
									{sandboxId}
								</span>
							)}
						</div>
					)}
					{output.stdout && (
						<pre className='font-mono text-sm rounded overflow-auto hide-code-header'>
							<Streamdown mode='static' controls={{ code: false }}>
								{`\`\`\`\n${output.stdout}\n\`\`\``}
							</Streamdown>
						</pre>
					)}
					{output.stderr && (
						<pre className='font-mono text-sm rounded overflow-auto hide-code-header text-red-400'>
							<Streamdown mode='static' controls={{ code: false }}>
								{`\`\`\`\n${output.stderr}\n\`\`\``}
							</Streamdown>
						</pre>
					)}
					{!output.stdout && !output.stderr && (
						<div className='p-4 text-center text-foreground/50 text-sm'>No output</div>
					)}
				</div>
			) : (
				<div className='p-4 text-center text-foreground/50 text-sm'>Running in sandbox...</div>
			)}
		</ToolCallWrapper>
	);
};
