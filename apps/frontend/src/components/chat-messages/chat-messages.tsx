import { memo, useEffect, useMemo, useRef } from 'react';
import { useParams, useRouterState } from '@tanstack/react-router';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { TextShimmer } from '../ui/text-shimmer';
import { ChatError } from './chat-error';
import { FollowUpSuggestions } from './follow-up-suggestions';
import { AssistantMessage } from './assistant-message';
import { UserMessage } from './user-message';
import type { UIMessage } from '@nao/backend/chat';
import type { MessageGroup } from '@/types/ai';
import { groupMessages, checkIsLastMessageStreaming, getLastFollowUpSuggestionsToolCall } from '@/lib/ai';
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
	ConversationScrollButton,
} from '@/components/ui/conversation';
import { cn, isLast } from '@/lib/utils';
import { useAgentContext } from '@/contexts/agent.provider';
import { useHeight } from '@/hooks/use-height';
import { useDebounceValue } from '@/hooks/use-debounce-value';

const DEBUG_MESSAGES = false;

export function ChatMessages() {
	const chatId = useParams({ strict: false }).chatId;
	const contentRef = useRef<HTMLDivElement>(null);
	const containerHeight = useHeight(contentRef, [chatId]);
	const { messages, isRunning } = useAgentContext();
	const isAgentGenerating = isRunning && checkIsLastMessageStreaming(messages);

	const lastMessageRole = messages.at(-1)?.role;
	const shouldResizeSmoothly = !isAgentGenerating && lastMessageRole === 'user';

	// Skip fade-in animation when navigating from home after sending a message
	const fromMessageSend = useRouterState({ select: (state) => state.location.state.fromMessageSend });

	return (
		<div
			className={cn('h-full min-h-0 flex', !fromMessageSend && 'animate-fade-in')}
			ref={contentRef}
			style={{ '--container-height': `${containerHeight}px` } as React.CSSProperties}
			key={chatId}
		>
			<Conversation resize={shouldResizeSmoothly ? 'smooth' : 'instant'}>
				<ConversationContent className='max-w-3xl mx-auto gap-0'>
					<ChatMessagesContent isAgentGenerating={isAgentGenerating} />
				</ConversationContent>

				<ConversationScrollButton />
			</Conversation>
		</div>
	);
}

const ChatMessagesContent = memo(({ isAgentGenerating }: { isAgentGenerating: boolean }) => {
	const { messages, isRunning, registerScrollDown } = useAgentContext();
	const { scrollToBottom } = useStickToBottomContext();
	const followUpSuggestionsToolCall = useMemo(() => getLastFollowUpSuggestionsToolCall(messages), [messages]);
	const extraComponentsRef = useRef<HTMLDivElement>(null);
	const extraComponentsHeight = useHeight(extraComponentsRef);

	useEffect(() => {
		// Register the scroll down fn so the agent context has access to it.
		const scrollDownSubscription = registerScrollDown(scrollToBottom);
		return () => scrollDownSubscription.dispose();
	}, [registerScrollDown, scrollToBottom]);

	const messageGroups = useMemo(() => groupMessages(messages), [messages]);

	// Debounce when the agent is running but not generating content yet to prevent flickering
	const isRunningButNotGeneratingDebounced = useDebounceValue(isRunning && !isAgentGenerating, {
		delay: 50,
		skipDebounce: (value) => !value, // Skip debounce if the value equals `false` to immediately remove the loader
	});

	return (
		<>
			<div
				className='flex flex-col gap-8'
				style={{ '--extra-components-height': `${extraComponentsHeight}px` } as React.CSSProperties}
			>
				{messageGroups.length === 0 ? (
					<ConversationEmptyState />
				) : (
					messageGroups.map((group) => (
						<MessageGroup
							key={group.userMessage.id}
							userMessage={group.userMessage}
							assistantMessages={group.assistantMessages}
							showLoader={isRunningButNotGeneratingDebounced && isLast(group, messageGroups)}
							isLastMessage={(messageId) => messageId === messages.at(-1)?.id}
							isRunning={isRunning}
						/>
					))
				)}
			</div>

			<div className='flex flex-col gap-4' ref={extraComponentsRef}>
				{followUpSuggestionsToolCall && <FollowUpSuggestions toolPart={followUpSuggestionsToolCall} />}

				<ChatError className='mt-4' />
			</div>
		</>
	);
});

const MessageGroup = ({
	userMessage,
	assistantMessages,
	showLoader,
	isLastMessage,
	isRunning,
}: {
	userMessage: UIMessage;
	assistantMessages: UIMessage[];
	showLoader: boolean;
	isLastMessage: (messageId: string) => boolean;
	isRunning: boolean;
}) => {
	return (
		<div className='flex flex-col gap-4 last:min-h-[calc(var(--container-height)-var(--extra-components-height)-calc(2*24px+16px))] group/message last:mb-4'>
			{[userMessage, ...assistantMessages].map((message) => (
				<MessageBlock
					key={message.id}
					message={message}
					showLoader={showLoader}
					isLastMessage={isLastMessage(message.id)}
					isRunning={isRunning}
				/>
			))}

			{showLoader && !assistantMessages.length && <TextShimmer className='px-3' />}
		</div>
	);
};

const MessageBlock = ({
	message,
	showLoader,
	isLastMessage,
	isRunning,
}: {
	message: UIMessage;
	showLoader: boolean;
	isLastMessage: boolean;
	isRunning: boolean;
}) => {
	const isUser = message.role === 'user';

	if (DEBUG_MESSAGES) {
		return (
			<div
				className={cn(
					'flex gap-3 text-xs',
					isUser ? 'justify-end bg-primary text-primary-foreground w-min ml-auto' : 'justify-start',
				)}
			>
				<pre>{JSON.stringify(message, null, 2)}</pre>
			</div>
		);
	}

	if (isUser) {
		return <UserMessage message={message} />;
	}

	return (
		<AssistantMessage
			message={message}
			showLoader={showLoader && isLastMessage}
			isCurrentGeneratedMessage={isLastMessage && isRunning}
			isSettled={!isLastMessage || !isRunning}
			isRunning={isRunning}
		/>
	);
};
