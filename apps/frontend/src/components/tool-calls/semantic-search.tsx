import { AlertCircle, File, Folder } from 'lucide-react';
import { ToolCallWrapper } from './tool-call-wrapper';
import type { ToolCallComponentProps } from '.';
import type { semanticSearch } from '@nao/shared/tools';
import { useToolCallContext } from '@/contexts/tool-call';

const LOW_COVERAGE = 0.35;

export const SemanticSearchToolCall = ({ toolPart: { output, input } }: ToolCallComponentProps<'semantic_search'>) => {
	const { isSettled } = useToolCallContext();
	const scope = input?.path && input.path !== '/' ? input.path : undefined;

	if (!isSettled) {
		return (
			<ToolCallWrapper
				title={<Title verb='Ranking context for' query={input?.query} scope={scope} />}
				children={<div className='p-4 text-center text-foreground/50 text-sm'>Ranking...</div>}
			/>
		);
	}

	return (
		<ToolCallWrapper
			title={<Title verb='Ranked context for' query={input?.query} scope={scope} />}
			badge={output && `(${output.results.length} of ${output.candidates})`}
		>
			{output && (
				<div className='overflow-auto max-h-80'>
					{output.candidates > 0 && output.coverage < LOW_COVERAGE && (
						<div className='px-3 py-2 border-b border-amber-500/20 bg-amber-500/5 flex items-center gap-2'>
							<AlertCircle size={14} className='text-amber-500 shrink-0' />
							<span className='text-xs text-amber-500'>
								This folder probably does not cover the query (coverage {formatPercent(output.coverage)}
								).
							</span>
						</div>
					)}
					<div className='flex flex-col gap-0.5 py-1'>
						{output.results.map((result) => (
							<ResultRow key={result.path} result={result} />
						))}
					</div>
					{output.results.length === 0 && (
						<div className='p-4 text-center text-foreground/50 text-sm'>No relevant context found</div>
					)}
				</div>
			)}
		</ToolCallWrapper>
	);
};

const Title = ({ verb, query, scope }: { verb: string; query?: string; scope?: string }) => (
	<>
		{verb} <code className='text-xs bg-background/50 px-1 py-0.5 rounded'>{query}</code>
		{scope && (
			<span className='text-foreground/50 text-xs ml-1'>
				in <code className='bg-background/50 px-1 py-0.5 rounded'>{scope}</code>
			</span>
		)}
	</>
);

const ResultRow = ({ result }: { result: semanticSearch.Result }) => (
	<div className='flex items-center gap-2 px-2 py-1 hover:bg-background/50 rounded text-sm' title={result.excerpt}>
		{result.type === 'directory' ? (
			<Folder size={14} className='text-violet shrink-0' />
		) : (
			<File size={14} className='text-primary-muted shrink-0' />
		)}
		<span className='font-mono text-xs flex-1 truncate min-w-0'>{result.path}</span>
		<RelevanceBar relevance={result.relevance} />
	</div>
);

const RelevanceBar = ({ relevance }: { relevance: number }) => (
	<div className='flex items-center gap-1.5 shrink-0'>
		<div className='w-16 h-1.5 rounded-full bg-foreground/10 overflow-hidden'>
			<div className='h-full rounded-full bg-violet' style={{ width: `${Math.round(relevance * 100)}%` }} />
		</div>
		<span className='text-xs text-foreground/40 w-8 text-right tabular-nums'>{formatPercent(relevance)}</span>
	</div>
);

const formatPercent = (probability: number) => `${Math.round(probability * 100)}%`;
