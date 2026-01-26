import { FileSearch, AlertCircle } from 'lucide-react';
import { useToolCallContext } from '../../contexts/tool-call.provider';
import { ToolCallWrapper } from './tool-call-wrapper';
import type { grepSchemas } from 'backend/tools';
import { isToolSettled } from '@/lib/ai';

export const GrepToolCall = () => {
	const { toolPart } = useToolCallContext();
	const output = toolPart.output as grepSchemas.Output | undefined;
	const input = toolPart.input as grepSchemas.Input | undefined;
	const isSettled = isToolSettled(toolPart);

	if (!isSettled) {
		return (
			<ToolCallWrapper
				title={
					<>
						Searching for{' '}
						<code className='text-xs bg-background/50 px-1 py-0.5 rounded font-mono'>{input?.pattern}</code>
					</>
				}
				children={<div className='p-4 text-center text-foreground/50 text-sm'>Searching...</div>}
			/>
		);
	}

	const badge = output
		? output.truncated
			? `(${output.matches.length}+ of ${output.total_matches} matches)`
			: `(${output.total_matches} matches)`
		: undefined;

	return (
		<ToolCallWrapper
			title={
				<>
					Grepped{' '}
					<code className='text-xs bg-background/50 px-1 py-0.5 rounded font-mono'>{input?.pattern}</code>
					{input?.glob && (
						<span className='text-foreground/50 text-xs ml-1'>
							in <code className='bg-background/50 px-1 py-0.5 rounded'>{input.glob}</code>
						</span>
					)}
				</>
			}
			badge={badge}
		>
			{output && (
				<div className='overflow-auto max-h-96'>
					{output.truncated && (
						<div className='px-3 py-2 border-b border-amber-500/20 bg-amber-500/5 flex items-center gap-2'>
							<AlertCircle size={14} className='text-amber-500 shrink-0' />
							<span className='text-xs text-amber-500'>
								Results truncated. Showing {output.matches.length} of {output.total_matches} matches.
							</span>
						</div>
					)}

					<div className='flex flex-col'>
						{output.matches.map((match, index) => (
							<div key={index} className='border-b border-foreground/5 last:border-b-0'>
								{/* File header */}
								<div className='flex items-center gap-2 px-3 py-1.5 bg-foreground/[0.02]'>
									<FileSearch size={12} className='text-foreground/40 shrink-0' />
									<span className='font-mono text-[11px] text-foreground/60 truncate'>
										{match.path}
									</span>
									<span className='text-[10px] text-foreground/30 shrink-0'>
										:{match.line_number}
									</span>
								</div>

								{/* Context before */}
								{match.context_before && match.context_before.length > 0 && (
									<div className='px-3 py-1 bg-foreground/[0.01]'>
										{match.context_before.map((line, i) => (
											<div
												key={i}
												className='font-mono text-xs text-foreground/30 leading-relaxed'
											>
												<span className='inline-block w-8 text-right mr-2 text-foreground/20 select-none'>
													{match.line_number - match.context_before!.length + i}
												</span>
												{line}
											</div>
										))}
									</div>
								)}

								{/* Match line */}
								<div className='px-3 py-1 bg-yellow-500/5'>
									<div className='font-mono text-xs leading-relaxed'>
										<span className='inline-block w-8 text-right mr-2 text-foreground/40 select-none'>
											{match.line_number}
										</span>
										<HighlightedLine content={match.line_content} pattern={input?.pattern} />
									</div>
								</div>

								{/* Context after */}
								{match.context_after && match.context_after.length > 0 && (
									<div className='px-3 py-1 bg-foreground/[0.01]'>
										{match.context_after.map((line, i) => (
											<div
												key={i}
												className='font-mono text-xs text-foreground/30 leading-relaxed'
											>
												<span className='inline-block w-8 text-right mr-2 text-foreground/20 select-none'>
													{match.line_number + 1 + i}
												</span>
												{line}
											</div>
										))}
									</div>
								)}
							</div>
						))}
					</div>

					{output.matches.length === 0 && (
						<div className='p-4 text-center text-foreground/50 text-sm'>No matches found</div>
					)}
				</div>
			)}
		</ToolCallWrapper>
	);
};

/**
 * Highlights the matching pattern in the line content
 */
const HighlightedLine = ({ content, pattern }: { content: string; pattern?: string }) => {
	if (!pattern) {
		return <span>{content}</span>;
	}

	try {
		const regex = new RegExp(`(${pattern})`, 'gi');
		const parts = content.split(regex);

		return (
			<>
				{parts.map((part, i) => {
					const isMatch = regex.test(part);
					// Reset regex lastIndex after test
					regex.lastIndex = 0;
					return isMatch ? (
						<mark key={i} className='bg-yellow-400/30 text-foreground rounded-sm px-0.5'>
							{part}
						</mark>
					) : (
						<span key={i}>{part}</span>
					);
				})}
			</>
		);
	} catch {
		// If the pattern is not a valid regex for JS, just show the content
		return <span>{content}</span>;
	}
};
