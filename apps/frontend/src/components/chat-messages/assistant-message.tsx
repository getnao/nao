import { memo, useMemo } from 'react';
import { Navigation } from 'lucide-react';
import type { UIMessage } from '@nao/backend/chat';
import type { GroupedMessagePart } from '@/types/ai';
import {
	areGroupedMessagePartArraysEqual,
	areGroupedMessagePartsEqual,
	checkAssistantMessageHasContent,
	getGroupedPartKeys,
	groupToolCalls,
	isQueryGroupPart,
	isStoryQueryGroupPart,
	isStoryStatusPart,
	isToolGroupPart,
	isToolUIPart,
} from '@/lib/ai';
import { ToolCallsGroup } from '@/components/tool-calls/tool-calls-group';
import { QueryGroup } from '@/components/tool-calls/query-group';
import { StoryStatus } from '@/components/tool-calls/story-status';
import { StoryQueryGroup } from '@/components/tool-calls/story-query-group';
import { ToolCall } from '@/components/tool-calls';
import { AssistantReasoning } from '@/components/chat-messages/assistant-reasoning';
import { AssistantCompaction } from '@/components/chat-messages/assistant-compaction';
import { AssistantTextWithCitation } from '@/components/chat-messages/citation-text';
import { TextShimmer } from '@/components/ui/text-shimmer';
import { AssistantMessageActions } from '@/components/chat-messages/assistant-message-actions';
import { cn, isLast } from '@/lib/utils';
import { useChatId } from '@/hooks/use-chat-id';
import { useIsCancellingMessage } from '@/hooks/use-is-cancelling-message-store';
import { useToolCallDensity } from '@/hooks/use-tool-call-density';
import { AssistantMessageProvider, useAssistantMessage } from '@/contexts/assistant-message';
import { useAgentContext } from '@/contexts/agent.provider';

export const AssistantMessage = memo(
	({
		message,
		isSettled,
		isRunning,
		isLastMessage,
		storyIntroMessageId,
	}: {
		message: UIMessage;
		isSettled: boolean;
		isRunning: boolean;
		isLastMessage: boolean;
		storyIntroMessageId: string | undefined;
	}) => {
		const chatId = useChatId();
		const { error } = useAgentContext();
		const [toolCallDensity] = useToolCallDensity();
		const messageParts = useMemo(
			() => groupToolCalls(message.parts, toolCallDensity),
			[message.parts, toolCallDensity],
		);
		const hasContent = useMemo(() => checkAssistantMessageHasContent(message), [message]);
		const isCancelling = useIsCancellingMessage(message.id);
		const isCompacting = message.parts.at(-1)?.type === 'data-compactionSummaryStarted';
		const showActions = message.id !== storyIntroMessageId;
		const hasFeedback = message.feedback != null;

		if (!message.parts.length && isSettled) {
			return null;
		}

		if (isCancelling && isSettled && !hasContent) {
			return null;
		}

		return (
			<AssistantMessageProvider isSettled={isSettled}>
				<div className={cn('group px-3 flex flex-col gap-2 bg-transparent')}>
					<MessageParts parts={messageParts} />

					{isSettled && !hasContent && !(isLastMessage && error) && (
						<div className='text-muted-foreground italic text-sm'>No response</div>
					)}

					{isCompacting ? <AssistantCompaction /> : !isSettled && <TextShimmer showLogo />}

					{chatId && showActions && !(isLastMessage && isRunning) && (
						<AssistantMessageActions
							message={message}
							chatId={chatId}
							className={cn(
								'transition-opacity duration-200',
								isLastMessage || hasFeedback ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
							)}
						/>
					)}
				</div>
			</AssistantMessageProvider>
		);
	},
);

export const MessageParts = memo(
	({ parts }: { parts: GroupedMessagePart[] }) => {
		const { isSettled } = useAssistantMessage();
		const keys = getGroupedPartKeys(parts);
		return parts.map((part, i) => {
			return <MessagePart key={keys[i]} part={part} isPartSettled={isSettled || !isLast(part, parts)} />;
		});
	},
	(previous, next) => areGroupedMessagePartArraysEqual(previous.parts, next.parts),
);

export const MessagePart = memo(
	({ part, isPartSettled }: { part: GroupedMessagePart; isPartSettled: boolean }) => {
		if (isToolGroupPart(part)) {
			return <ToolCallsGroup parts={part.parts} isSettled={isPartSettled} />;
		}

		if (isQueryGroupPart(part)) {
			return <QueryGroup parts={part.parts} isSettled={isPartSettled} />;
		}

		if (isStoryStatusPart(part)) {
			return <StoryStatus toolPart={part.part} />;
		}

		if (isStoryQueryGroupPart(part)) {
			return <StoryQueryGroup parts={part.parts} isSettled={isPartSettled} />;
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
			case 'data-steer':
				return <SteeredMessage text={part.data.text} />;
			default:
				return null;
		}
	},
	(previous, next) =>
		previous.isPartSettled === next.isPartSettled && areGroupedMessagePartsEqual(previous.part, next.part),
);

function SteeredMessage({ text }: { text: string }) {
	return (
		<div className='flex flex-col items-end gap-1 my-1'>
			<span className='flex items-center gap-1 text-xs text-muted-foreground'>
				<Navigation className='size-3' />
				Steered mid-answer
			</span>
			<div className='rounded-2xl px-3 py-2 bg-panel text-card-foreground max-w-xl whitespace-pre-wrap'>
				{text}
			</div>
		</div>
	);
}
