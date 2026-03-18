import { memo, useMemo } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { UserMessageBubble } from './user-message';
import type { UIMessage } from '@nao/backend/chat';
import { checkAssistantMessageHasContent, groupMessages, groupToolCalls } from '@/lib/ai';
import { cn } from '@/lib/utils';
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
	ConversationScrollButton,
} from '@/components/ui/conversation';
import { AssistantCompaction } from '@/components/chat-messages/assistant-compaction';
import { AssistantMessageProvider } from '@/contexts/assistant-message';
import { MessageParts } from '@/components/chat-messages/assistant-message';

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
}: {
	userMessage: UIMessage;
	assistantMessages: UIMessage[];
}) => {
	return (
		<div className='flex flex-col gap-4 last:mb-4'>
			{[userMessage, ...assistantMessages].map((message) => (
				<MessageBlockReadonly key={message.id} message={message} />
			))}
		</div>
	);
};

const MessageBlockReadonly = ({ message }: { message: UIMessage }) => {
	if (message.role === 'user') {
		return <UserMessageReadonly message={message} />;
	}

	return <AssistantMessageReadonly message={message} />;
};

const UserMessageReadonly = memo(({ message }: { message: UIMessage }) => {
	return (
		<div className='flex flex-col gap-2 items-end w-full p-2'>
			<UserMessageBubble message={message} />
		</div>
	);
});

const AssistantMessageReadonly = memo(({ message }: { message: UIMessage }) => {
	const messageParts = useMemo(() => groupToolCalls(message.parts), [message.parts]);
	const hasContent = useMemo(() => checkAssistantMessageHasContent(message), [message]);
	const isCompacting = message.parts.at(-1)?.type === 'data-compactionSummaryStarted';

	if (!message.parts.length) {
		return null;
	}

	return (
		<AssistantMessageProvider isSettled={true}>
			<div className={cn('group px-3 flex flex-col gap-2 bg-transparent')}>
				<MessageParts parts={messageParts} />

				{message.feedback && (
					<div
						data-replay-nav='feedback'
						data-replay-nav-vote={message.feedback.vote}
						className='flex items-center gap-1.5 text-xs text-muted-foreground mt-1 p-1'
					>
						{message.feedback.vote === 'up' ? (
							<ThumbsUp className='size-3.5 text-green-600' />
						) : (
							<ThumbsDown className='size-3.5 text-red-500' />
						)}
						<span>Feedback</span>
						{message.feedback.vote === 'down' &&
							message.feedback.explanation != null &&
							message.feedback.explanation.trim() !== '' && (
								<span className='text-xs font-semibold'> : {message.feedback.explanation}</span>
							)}
					</div>
				)}

				{!hasContent && <div className='text-muted-foreground italic text-sm'>No response</div>}

				{isCompacting && <AssistantCompaction />}
			</div>
		</AssistantMessageProvider>
	);
});
