import { HelpCircle } from 'lucide-react';
import { memo } from 'react';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import type { ToolCallComponentProps } from '.';
import { useSetChatInputCallback } from '@/contexts/set-chat-input-callback';
import { useToolCallContext } from '@/contexts/tool-call';

export const ClarificationToolCall = memo(({ toolPart }: ToolCallComponentProps<'clarification'>) => {
	const { isSettled } = useToolCallContext();
	const setPromptCallback = useSetChatInputCallback();
	const input = toolPart.input;
	const isStreaming = toolPart.state === 'input-streaming';

	if (isStreaming && !input?.question) {
		return <ClarificationSkeleton />;
	}

	if (!input?.question) {
		return null;
	}

	const options: string[] =
		input.options?.flatMap((option) => {
			if (typeof option !== 'string') {
				return [];
			}
			const trimmed = option.trim();
			return trimmed ? [trimmed] : [];
		}) ?? [];

	return (
		<div className='flex flex-col gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3 animate-fade-in-up'>
			<div className='flex items-start gap-2'>
				<HelpCircle size={16} className='mt-0.5 shrink-0 text-muted-foreground' />
				<div className='flex flex-col gap-0.5'>
					<span className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
						Quick question
					</span>
					<p className='text-sm leading-relaxed text-foreground whitespace-pre-wrap'>{input.question}</p>
				</div>
			</div>

			{options.length > 0 && (
				<div className='flex flex-wrap gap-2 pl-6'>
					{options.map((option, index) => (
						<Button
							key={`${index}-${option}`}
							variant='outline'
							size='sm'
							disabled={isStreaming || !isSettled}
							onClick={() => setPromptCallback.fire(option)}
							className='rounded-full'
						>
							<span className='truncate max-w-[28ch]'>{option}</span>
						</Button>
					))}
				</div>
			)}

			<p className='pl-6 text-xs text-muted-foreground'>
				{options.length > 0 ? 'Pick an option or type your own answer below.' : 'Type your answer below.'}
			</p>
		</div>
	);
});

const ClarificationSkeleton = () => (
	<div className='flex flex-col gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3 animate-fade-in-up'>
		<div className='flex items-start gap-2'>
			<HelpCircle size={16} className='mt-0.5 shrink-0 text-muted-foreground opacity-50' />
			<div className='flex flex-col gap-1.5 w-full'>
				<Skeleton className='h-3 w-24 rounded' />
				<Skeleton className='h-4 w-3/4 rounded' />
			</div>
		</div>
		<div className='flex flex-wrap gap-2 pl-6'>
			{Array.from({ length: 3 }).map((_, idx) => (
				<Skeleton key={idx} className='h-7 w-24 rounded-full' />
			))}
		</div>
	</div>
);
