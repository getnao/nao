import { memo, useMemo } from 'react';
import { Streamdown } from 'streamdown';
import type { UIMessage } from '@nao/backend/chat';

import type { GroupedMessagePart } from '@/types/ai';
import {
	checkAssistantMessageHasContent,
	getMessageText,
	groupMessages,
	groupToolCalls,
	isToolGroupPart,
	isToolUIPart,
} from '@/lib/ai';
import { cn } from '@/lib/utils';
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
	ConversationScrollButton,
} from '@/components/ui/conversation';
import { ToolCallsGroup } from '@/components/tool-calls/tool-calls-group';
import { ToolCall } from '@/components/tool-calls';
import { AssistantReasoning } from '@/components/chat-messages/assistant-reasoning';
import { AssistantCompaction } from '@/components/chat-messages/assistant-compaction';
import SlackIcon from '@/components/icons/slack.svg';
import { AssistantMessageProvider } from '@/contexts/assistant-message';

export function ChatMessagesReadonly({ messages, className }: { messages: UIMessage[]; className?: string }) {
	const messageGroups = useMemo(() => groupMessages(messages), [messages]);

	return (
		<div className={cn('h-full min-h-0 flex', className)}>
			<Conversation>
				<ConversationContent className='max-w-3xl mx-auto gap-0'>
					{messageGroups.length === 0 ? (
						<ConversationEmptyState title='No messages' description='' />
					) : (
						messageGroups.map((group) => (
							<MessageGroupReadonly
								key={group.userMessage.id}
								userMessage={group.userMessage}
								assistantMessages={group.assistantMessages}
								isLastMessage={(messageId) => messageId === messages.at(-1)?.id}
							/>
						))
					)}
				</ConversationContent>

				<ConversationScrollButton />
			</Conversation>
		</div>
	);
}

const MessageGroupReadonly = ({
	userMessage,
	assistantMessages,
	isLastMessage,
}: {
	userMessage: UIMessage;
	assistantMessages: UIMessage[];
	isLastMessage: (messageId: string) => boolean;
}) => {
	return (
		<div className='flex flex-col gap-4 last:mb-4'>
			{[userMessage, ...assistantMessages].map((message) => (
				<MessageBlockReadonly key={message.id} message={message} isLastMessage={isLastMessage(message.id)} />
			))}
		</div>
	);
};

const MessageBlockReadonly = ({ message, isLastMessage }: { message: UIMessage; isLastMessage: boolean }) => {
	if (message.role === 'user') {
		return <UserMessageReadonly message={message} />;
	}

	return <AssistantMessageReadonly message={message} isLastMessage={isLastMessage} />;
};

const UserMessageReadonly = memo(({ message }: { message: UIMessage }) => {
	const text = useMemo(() => getMessageText(message), [message]);
	return (
		<div className='group flex flex-col gap-2'>
			<div className={cn('rounded-2xl px-3 py-2 bg-card text-card-foreground ml-auto max-w-xl border')}>
				{message.source === 'slack' && (
					<span className='flex items-center justify-end gap-1 text-xs text-muted-foreground'>
						<SlackIcon className='size-3.5' />
						sent in Slack
					</span>
				)}
				<span className='whitespace-pre-wrap wrap-break-word'>{text}</span>
			</div>
		</div>
	);
});

const AssistantMessageReadonly = memo(({ message, isLastMessage }: { message: UIMessage; isLastMessage: boolean }) => {
	const messageParts = useMemo(() => groupToolCalls(message.parts), [message.parts]);
	const hasContent = useMemo(() => checkAssistantMessageHasContent(message), [message]);
	const isCompacting = message.parts.at(-1)?.type === 'data-compactionSummaryStarted';

	if (!message.parts.length) {
		return null;
	}

	return (
		<AssistantMessageProvider isSettled={true}>
			<div className={cn('group px-3 flex flex-col gap-2 bg-transparent')}>
				<MessagePartsReadonly parts={messageParts} />

				{!hasContent && <div className='text-muted-foreground italic text-sm'>No response</div>}

				{isCompacting && <AssistantCompaction />}
				{isLastMessage && null}
			</div>
		</AssistantMessageProvider>
	);
});

const MessagePartsReadonly = memo(({ parts }: { parts: GroupedMessagePart[] }) => {
	return parts.map((part, i) => {
		return <MessagePartReadonly key={i} part={part} />;
	});
});

const MessagePartReadonly = memo(({ part }: { part: GroupedMessagePart }) => {
	if (isToolGroupPart(part)) {
		return <ToolCallsGroup parts={part.parts} isSettled={true} />;
	}

	if (isToolUIPart(part)) {
		return <ToolCall toolPart={part} />;
	}

	switch (part.type) {
		case 'text':
			return (
				<Streamdown isAnimating={false} mode='static'>
					{part.text}
				</Streamdown>
			);
		case 'reasoning':
			return <AssistantReasoning text={part.text} isStreaming={false} />;
		case 'data-compaction':
			return <AssistantCompaction part={part.data} />;
		default:
			return null;
	}
});
