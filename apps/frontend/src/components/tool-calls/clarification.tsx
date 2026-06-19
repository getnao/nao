import { Check, HelpCircle } from 'lucide-react';
import { memo, useMemo } from 'react';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import type { ToolCallComponentProps } from '.';
import type { UIMessage } from '@nao/backend/chat';
import { useAgentContext } from '@/contexts/agent.provider';
import { useToolCallContext } from '@/contexts/tool-call';
import { getMessageText } from '@/lib/ai';
import { cn } from '@/lib/utils';

type AnsweredState = { isAnswered: true; answer: string } | { isAnswered: false; answer?: undefined };

export const ClarificationToolCall = memo(({ toolPart }: ToolCallComponentProps<'clarification'>) => {
	const { isSettled } = useToolCallContext();
	const { messages, queueOrSendMessage, isRunning } = useAgentContext();

	const answeredState = useMemo<AnsweredState>(
		() => getAnsweredStateForToolCall(messages, toolPart.toolCallId),
		[messages, toolPart.toolCallId],
	);

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

	const { isAnswered } = answeredState;
	const canSubmit = !isStreaming && isSettled && !isAnswered && !isRunning;

	const handleSelect = (option: string) => {
		if (!canSubmit) {
			return;
		}
		void queueOrSendMessage({ text: option });
	};

	return (
		<div
			className={cn(
				'flex flex-col gap-3 rounded-xl border border-border bg-muted/30 -mx-3 px-4 py-3 animate-fade-in-up',
				isAnswered && 'bg-muted/10',
			)}
		>
			<div className='flex items-start gap-2'>
				<HelpCircle size={16} className='mt-0.5 shrink-0 text-muted-foreground' />
				<div className='flex flex-col gap-0.5'>
					<span className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
						{isAnswered ? 'Answered' : 'Quick question'}
					</span>
					<p className='text-sm leading-relaxed text-foreground whitespace-pre-wrap'>{input.question}</p>
				</div>
			</div>

			{options.length > 0 && (
				<div className='flex flex-wrap gap-2 pl-6'>
					{options.map((option, index) => {
						const isSelected =
							isAnswered && answeredState.answer.trim().toLowerCase() === option.trim().toLowerCase();
						return (
							<Button
								key={`${index}-${option}`}
								variant={isSelected ? 'secondary' : 'outline'}
								size='sm'
								disabled={!canSubmit && !isSelected}
								onClick={() => handleSelect(option)}
								className='rounded-2xl h-auto min-h-7 max-w-full whitespace-normal py-1 text-left'
							>
								{isSelected && <Check className='size-3.5 shrink-0' />}
								<span className='break-words whitespace-normal'>{option}</span>
							</Button>
						);
					})}
				</div>
			)}

			{!isAnswered && (
				<p className='pl-6 text-xs text-muted-foreground'>
					{options.length > 0
						? 'Click an option to send it, or type your own answer below.'
						: 'Type your answer below.'}
				</p>
			)}
		</div>
	);
});

/**
 * Find whether the user has already answered this clarification turn by
 * looking for a user message that appears after the assistant message
 * containing this tool call.
 */
function getAnsweredStateForToolCall(messages: UIMessage[], toolCallId: string): AnsweredState {
	const toolMessageIndex = messages.findIndex((message) =>
		message.parts.some((part) => part.type === 'tool-clarification' && part.toolCallId === toolCallId),
	);
	if (toolMessageIndex === -1) {
		return { isAnswered: false };
	}

	for (let i = toolMessageIndex + 1; i < messages.length; i++) {
		const message = messages[i];
		if (message.role === 'user') {
			return { isAnswered: true, answer: getMessageText(message).trim() };
		}
	}

	return { isAnswered: false };
}

const ClarificationSkeleton = () => (
	<div className='flex flex-col gap-3 rounded-xl border border-border bg-muted/30 -mx-3 px-4 py-3 animate-fade-in-up'>
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
