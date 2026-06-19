import { memo, useMemo } from 'react';
import type { UIMessage } from '@nao/backend/chat';
import type { GroupedMessagePart } from '@/types/ai';
import { checkAssistantMessageHasContent, groupToolCalls, isToolGroupPart, isToolUIPart } from '@/lib/ai';
import { ToolCallsGroup } from '@/components/tool-calls/tool-calls-group';
import { ToolCall } from '@/components/tool-calls';
import { AssistantReasoning } from '@/components/chat-messages/assistant-reasoning';
import { AssistantCompaction } from '@/components/chat-messages/assistant-compaction';
import { AssistantTextWithCitation } from '@/components/chat-messages/citation-text';
import { TextShimmer } from '@/components/ui/text-shimmer';
import { AssistantMessageActions } from '@/components/chat-messages/assistant-message-actions';
import { cn, isLast } from '@/lib/utils';
import { useChatId } from '@/hooks/use-chat-id';
import { useToolCallDensity } from '@/hooks/use-tool-call-density';
import { AssistantMessageProvider, useAssistantMessage } from '@/contexts/assistant-message';

export const AssistantMessage = memo(
	({
		message,
		showLoader,
		isSettled,
		isRunning,
		isLastMessage,
		storyIntroMessageId,
	}: {
		message: UIMessage;
		showLoader: boolean;
		isSettled: boolean;
		isRunning: boolean;
		isLastMessage: boolean;
		storyIntroMessageId: string | undefined;
	}) => {
		const chatId = useChatId();
		const [toolCallDensity] = useToolCallDensity();
		const messageParts = useMemo(
			() => groupToolCalls(message.parts, toolCallDensity),
			[message.parts, toolCallDensity],
		);
		const hasContent = useMemo(() => checkAssistantMessageHasContent(message), [message]);
		const isCompacting = message.parts.at(-1)?.type === 'data-compactionSummaryStarted';
		const showActions = message.id !== storyIntroMessageId;
		const hasFeedback = message.feedback != null;

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

					{isCompacting ? <AssistantCompaction /> : showLoader && <TextShimmer showLogo />}

					{chatId && showActions && (
						<AssistantMessageActions
							message={message}
							chatId={chatId}
							className={cn(
								'transition-opacity duration-200',
								isLastMessage
									? isRunning
										? 'hidden'
										: 'opacity-100'
									: hasFeedback
										? 'opacity-100'
										: 'opacity-0 group-hover:opacity-100',
							)}
						/>
					)}
				</div>
			</AssistantMessageProvider>
		);
	},
);

export const MessageParts = memo(({ parts }: { parts: GroupedMessagePart[] }) => {
	const { isSettled } = useAssistantMessage();
	return parts.map((part, i) => {
		return <MessagePart key={i} part={part} isPartSettled={isSettled || !isLast(part, parts)} />;
	});
});

export const MessagePart = memo(({ part, isPartSettled }: { part: GroupedMessagePart; isPartSettled: boolean }) => {
	if (isToolGroupPart(part)) {
		return <ToolCallsGroup parts={part.parts} isSettled={isPartSettled} />;
	}

	if (isToolUIPart(part)) {
		return <ToolCall toolPart={part} />;
	}

	const isPartStreaming = !isPartSettled && 'state' in part && part.state === 'streaming';

	switch (part.type) {
		case 'text':
			return <AssistantTextWithCitation text={part.text} isStreaming={isPartStreaming} />;
		case 'reasoning':
			return <AssistantReasoning text={part.text} isStreaming={isPartStreaming} />;
		case 'data-compaction':
			return <AssistantCompaction part={part.data} />;
		default:
			return null;
	}
});
