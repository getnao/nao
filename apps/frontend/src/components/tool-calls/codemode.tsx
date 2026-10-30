import { useState } from 'react';
import { Streamdown } from 'streamdown';
import { Code, Copy, SquareFunction, Terminal } from 'lucide-react';
import { ToolCallWrapper } from './tool-call-wrapper';
import { ToolOutputFallback } from './tool-output-fallback';
import type { codemode } from '@nao/shared/tools';
import type { ToolCallComponentProps } from '.';
import { useToolCallContext } from '@/contexts/tool-call';
import { cn } from '@/lib/utils';

type ViewMode = 'output' | 'code';

export const CodemodeToolCall = ({ toolPart: { output, input } }: ToolCallComponentProps<'codemode'>) => {
	const [viewMode, setViewMode] = useState<ViewMode>('output');
	const { isSettled } = useToolCallContext();

	const actions = [
		{
			id: 'output',
			label: <Terminal className='size-3 text-muted-foreground/70' strokeWidth={2.25} />,
			isActive: viewMode === 'output',
			onClick: () => setViewMode('output'),
			title: 'View output',
		},
		{
			id: 'code',
			label: <Code className='size-3 text-muted-foreground/70' strokeWidth={2.25} />,
			isActive: viewMode === 'code',
			onClick: () => setViewMode('code'),
			title: 'View code',
		},
		{
			id: 'copy',
			label: <Copy className='size-3 text-muted-foreground/70' strokeWidth={2.25} />,
			onClick: () => {
				navigator.clipboard.writeText(input?.code ?? '');
			},
			title: 'Copy code',
		},
	];

	return (
		<ToolCallWrapper
			defaultExpanded={false}
			overrideError={viewMode === 'code'}
			title={
				<span className='flex items-center gap-1.5'>
					<SquareFunction size={12} className='shrink-0 opacity-60' />
					{isSettled ? 'Ran script' : 'Running script'}{' '}
					<span className='text-xs font-normal truncate'>{input?.description}</span>
				</span>
			}
			badge={isSettled && output ? <CodemodeBadge output={output} /> : undefined}
			actions={isSettled ? actions : []}
		>
			{viewMode === 'code' && input?.code ? (
				<div className='overflow-auto max-h-80 hide-code-header'>
					<Streamdown mode='static' controls={{ code: false }}>
						{codeFence('javascript', input.code)}
					</Streamdown>
				</div>
			) : output ? (
				<CodemodeOutput output={output} />
			) : (
				<ToolOutputFallback runningLabel='Running script...' />
			)}
		</ToolCallWrapper>
	);
};

const CodemodeBadge = ({ output }: { output: codemode.Output }) => {
	const callCount = output.calls.length;
	return (
		<span className='flex items-center gap-2'>
			{callCount > 0 && (
				<span>
					{callCount} call{callCount > 1 ? 's' : ''}
				</span>
			)}
			{!output.ok && <span className='text-red-400'>{output.error?.kind ?? 'failed'}</span>}
		</span>
	);
};

const CodemodeOutput = ({ output }: { output: codemode.Output }) => {
	const hasResult = output.result !== undefined;
	const hasLogs = output.logs.length > 0;

	return (
		<div className='overflow-auto max-h-80'>
			{output.calls.length > 0 && <CallList calls={output.calls} />}
			{hasLogs && (
				<pre className='font-mono text-sm rounded overflow-auto hide-code-header'>
					<Streamdown mode='static' controls={{ code: false }}>
						{codeFence('', output.logs.join('\n'))}
					</Streamdown>
				</pre>
			)}
			{hasResult && (
				<pre className='font-mono text-sm rounded overflow-auto hide-code-header'>
					<Streamdown mode='static' controls={{ code: false }}>
						{codeFence('json', prettifyJson(output.result ?? ''))}
					</Streamdown>
				</pre>
			)}
			{output.error && (
				<pre className='font-mono text-xs px-3 py-2 whitespace-pre-wrap text-red-400'>
					{output.error.stack ?? output.error.message}
				</pre>
			)}
			{output.ok && !hasResult && !hasLogs && (
				<div className='p-4 text-center text-foreground/50 text-sm'>No output</div>
			)}
		</div>
	);
};

const CallList = ({ calls }: { calls: codemode.Call[] }) => (
	<div className='flex flex-col gap-0.5 px-3 py-2 border-b border-border text-xs'>
		{calls.map((call, index) => (
			<div key={index} className='flex items-center gap-2 font-mono min-w-0'>
				<span
					className={cn(
						'size-1.5 rounded-full shrink-0',
						call.status === 'ok' && 'bg-green-500',
						call.status === 'error' && 'bg-red-500',
						call.status === 'cancelled' && 'bg-muted-foreground/50',
					)}
				/>
				<span className='truncate text-foreground/80'>{call.name}</span>
				{call.error && (
					<span className='truncate text-red-400' title={call.error}>
						{call.error}
					</span>
				)}
				<span className='ml-auto shrink-0 text-foreground/50'>{formatDuration(call.durationMs)}</span>
			</div>
		))}
	</div>
);

function codeFence(language: string, content: string): string {
	return `\`\`\`${language}\n${content}\n\`\`\``;
}

function prettifyJson(json: string): string {
	try {
		return JSON.stringify(JSON.parse(json), null, 2);
	} catch {
		return json;
	}
}

function formatDuration(durationMs: number): string {
	return durationMs < 1000 ? `${Math.round(durationMs)} ms` : `${(durationMs / 1000).toFixed(1)} s`;
}
