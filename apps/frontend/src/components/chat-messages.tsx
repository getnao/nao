import { Streamdown } from 'streamdown';
import { useEffect, useMemo, useRef } from 'react';
import { useParams, useRouterState } from '@tanstack/react-router';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { ToolCall } from './tool-call';
import { ToolCallsGroup } from './tool-call/tool-calls-group';
import { ReasoningAccordion } from './chat-message-reasoning-accordion';
import { AgentMessageLoader } from './ui/agent-message-loader';
import { MessageActions } from './chat-message-actions';
import { ChatError } from './chat-error';
import type { UIMessage } from 'backend/chat';
import type { MessageGroup } from '@/types/messages';
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
	ConversationScrollButton,
} from '@/components/ui/conversation';
import { isToolUIPart, checkIsAgentGenerating, groupToolCalls, isToolGroupPart } from '@/lib/ai';
import { cn, isLast } from '@/lib/utils';
import { useAgentContext } from '@/contexts/agent.provider';
import { useHeight } from '@/hooks/use-height';
import { groupMessages } from '@/lib/messages.utils';
import { useDebounce } from '@/hooks/use-debounce';

const DEBUG_MESSAGES = false;

export function ChatMessages() {
	const chatId = useParams({ strict: false }).chatId;
	const contentRef = useRef<HTMLDivElement>(null);
	const containerHeight = useHeight(contentRef, [chatId]);
	const { messages, status } = useAgentContext();
	const isAgentGenerating = checkIsAgentGenerating({ status, messages });
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
				<ConversationContent className='max-w-3xl mx-auto'>
					<ChatMessagesContent isAgentGenerating={isAgentGenerating} />
				</ConversationContent>

				<ConversationScrollButton />
			</Conversation>
		</div>
	);
}

const ChatMessagesContent = ({ isAgentGenerating }: { isAgentGenerating: boolean }) => {
	const { messages, isRunning, registerScrollDown } = useAgentContext();
	const { scrollToBottom } = useStickToBottomContext();

	useEffect(() => {
		// Register the scroll down fn so the agent context has access to it.
		const scrollDownSubscription = registerScrollDown(scrollToBottom);
		return () => {
			scrollDownSubscription.dispose();
		};
	}, [registerScrollDown, scrollToBottom]);

	const messageGroups = useMemo(() => groupMessages(messages), [messages]);

	// isRunning is status-based; isAgentGenerating means content/tool activity on the last message.
	/** `true` when the agent is running but it's not yet streaming content (text, reasoning or tool calls) */
	const isWaitingForAgentContentGeneration = isRunning && !isAgentGenerating;

	// Debounce the value to prevent flickering
	const debouncedIsWaitingForAgentContentGeneration = useDebounce({
		value: isWaitingForAgentContentGeneration,
		delay: 50,
		skipDebounce: (value) => !value, // Skip debounce if the value equals `false` to immediately remove the loader
	});

	return (
		<>
			{messageGroups.length === 0 ? (
				<ConversationEmptyState />
			) : (
				messageGroups.map((group) => (
					<MessageGroup
						key={group.user.id}
						group={group}
						showResponseLoader={isLast(group, messageGroups) && debouncedIsWaitingForAgentContentGeneration}
					/>
				))
			)}
			<ChatError className='mt-4' />
		</>
	);
};

function MessageGroup({ group, showResponseLoader }: { group: MessageGroup; showResponseLoader: boolean }) {
	return (
		<div className='flex flex-col gap-8 last:min-h-[calc(var(--container-height)-48px)] group/message'>
			{[group.user, ...group.responses].map((message) => (
				<MessageBlock
					key={message.id}
					message={message}
					showResponseLoader={showResponseLoader && isLast(message, group.responses)}
				/>
			))}
			{showResponseLoader && !group.responses.length && <AgentMessageLoader />}
		</div>
	);
}

function MessageBlock({ message, showResponseLoader }: { message: UIMessage; showResponseLoader: boolean }) {
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
		return <UserMessageBlock message={message} />;
	}

	return <AssistantMessageBlock message={message} showResponseLoader={showResponseLoader} />;
}

const UserMessageBlock = ({ message }: { message: UIMessage }) => {
	return (
		<div className={cn('rounded-2xl px-3 py-2 bg-card text-card-foreground ml-auto max-w-xl border')}>
			{message.parts.map((p, i) => {
				switch (p.type) {
					case 'text':
						return (
							<span key={i} className='whitespace-pre-wrap wrap-break-word'>
								{p.text}
							</span>
						);
					default:
						return null;
				}
			})}
		</div>
	);
};

const AssistantMessageBlock = ({
	message,
	showResponseLoader,
}: {
	message: UIMessage;
	showResponseLoader: boolean;
}) => {
	const chatId = useParams({ strict: false }).chatId;
	const { isRunning, messages } = useAgentContext();
	const isLastMessage = isLast(message, messages);
	const groupedParts = useMemo(() => groupToolCalls(message.parts), [message.parts]);

	if (!message.parts.length && !showResponseLoader) {
		return null;
	}

	return (
		<div className={cn('group px-3 flex flex-col gap-2 bg-transparent')}>
			{groupedParts.map((p, i) => {
				if (isToolGroupPart(p)) {
					return (
						<ToolCallsGroup
							key={i}
							parts={p.parts}
							expand={isLastMessage && isLast(p, groupedParts) && isRunning}
						/>
					);
				}

				if (isToolUIPart(p)) {
					return <ToolCall key={i} toolPart={p} />;
				}

				const isPartStreaming = 'state' in p && p.state === 'streaming';

				switch (p.type) {
					case 'text':
						return (
							<Streamdown
								key={i}
								isAnimating={isPartStreaming}
								mode={isPartStreaming ? 'streaming' : 'static'}
								cdnUrl={null}
							>
								{p.text}
							</Streamdown>
						);
					case 'reasoning':
						return <ReasoningAccordion key={i} text={p.text} isStreaming={isPartStreaming} />;
					default:
						return null;
				}
			})}

			{showResponseLoader && <AgentMessageLoader className='p-0' />}

			{chatId && (
				<MessageActions
					message={message}
					chatId={chatId}
					className={cn(
						'opacity-0 group-last/message:opacity-100 group-hover:opacity-100 transition-opacity duration-200',
						isRunning ? 'group-last/message:hidden' : '',
					)}
				/>
			)}
		</div>
	);
};
