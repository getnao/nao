import { memo, useMemo } from 'react';
import { Streamdown } from 'streamdown';
import type { UIMessage } from '@nao/backend/chat';
import type { GroupedMessagePart } from '@/types/ai';
import { checkAssistantMessageHasContent, groupToolCalls, isToolGroupPart, isToolUIPart } from '@/lib/ai';
import { ToolCallsGroup } from '@/components/tool-calls/tool-calls-group';
import { ToolCall } from '@/components/tool-calls';
import { AssistantReasoning } from '@/components/chat-messages/assistant-reasoning';
import { AssistantCompaction } from '@/components/chat-messages/assistant-compaction';
import { TextShimmer } from '@/components/ui/text-shimmer';
import { AssistantMessageActions } from '@/components/chat-messages/assistant-message-actions';
import { cn, isLast } from '@/lib/utils';
import { useChatId } from '@/hooks/use-chat-id';
import { AssistantMessageProvider, useAssistantMessage } from '@/contexts/assistant-message';

export const AssistantMessage = memo(
	({
		message,
		showLoader,
		isSettled,
		isRunning,
	}: {
		message: UIMessage;
		showLoader: boolean;
		isSettled: boolean;
		isRunning: boolean;
	}) => {
		const chatId = useChatId();
		const messageParts = useMemo(() => groupToolCalls(message.parts), [message.parts]);
		const hasContent = useMemo(() => checkAssistantMessageHasContent(message), [message]);
		const isCompacting = useMemo(
			() =>
				messageParts.filter((p) => p.type === 'data-compactionSummaryStarted').length >
				messageParts.filter((p) => p.type === 'data-compaction').length,
			[messageParts],
		);

		if (!message.parts.length && isSettled) {
			return null;
		}

		return (
			<AssistantMessageProvider isSettled={isSettled}>
				<div className={cn('group px-3 flex flex-col gap-2 bg-transparent')}>
					<MessageParts parts={messageParts} />

					{isSettled && !hasContent && (
						<div className='text-muted-foreground italic text-sm'>No response</div>
					)}

					{showLoader && !isCompacting && <TextShimmer />}

					{chatId && (
						<AssistantMessageActions
							message={message}
							chatId={chatId}
							className={cn(
								'opacity-0 group-last/message:opacity-100 group-hover:opacity-100 transition-opacity duration-200',
								isRunning ? 'group-last/message:hidden' : '',
							)}
						/>
					)}
				</div>
			</AssistantMessageProvider>
		);
	},
);

const MessageParts = memo(({ parts }: { parts: GroupedMessagePart[] }) => {
	const { isSettled } = useAssistantMessage();
	return parts.map((part, i) => {
		const hasCompactionAfter =
			part.type === 'data-compactionSummaryStarted'
				? parts.slice(i + 1).some((p) => p.type === 'data-compaction')
				: false;

		return (
			<MessagePart
				key={i}
				part={part}
				hasCompactionAfter={hasCompactionAfter}
				isPartSettled={isSettled || !isLast(part, parts)}
			/>
		);
	});
});

const MessagePart = memo(
	({
		part,
		hasCompactionAfter,
		isPartSettled,
	}: {
		part: GroupedMessagePart;
		hasCompactionAfter: boolean;
		isPartSettled: boolean;
	}) => {
		if (isToolGroupPart(part)) {
			return <ToolCallsGroup parts={part.parts} isSettled={isPartSettled} />;
		}

		if (isToolUIPart(part)) {
			return <ToolCall toolPart={part} />;
		}

		const isPartStreaming = !isPartSettled && 'state' in part && part.state === 'streaming';

		switch (part.type) {
			case 'text':
				return (
					<Streamdown isAnimating={isPartStreaming} mode={isPartStreaming ? 'streaming' : 'static'}>
						{part.text}
					</Streamdown>
				);
			case 'reasoning':
				return <AssistantReasoning text={part.text} isStreaming={isPartStreaming} />;
			case 'data-compactionSummaryStarted':
				return hasCompactionAfter ? null : <AssistantCompaction summary={''} isSummarizing={true} />;
			case 'data-compaction':
				return <AssistantCompaction summary={part.data.summary} isSummarizing={false} />;
			default:
				return null;
		}
	},
);
