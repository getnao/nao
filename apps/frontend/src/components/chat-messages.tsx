import { Streamdown } from 'streamdown';
import { useEffect, useMemo, useRef } from 'react';
import { useParams } from '@tanstack/react-router';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { ToolCall } from './tool-call';
import { ReasoningAccordion } from './chat-message-reasoning-accordion';
import { AgentMessageLoader } from './ui/agent-message-loader';
import { MessageActions } from './chat-message-actions';
import type { UIMessage } from 'backend/chat';
import type { MessageGroup } from '@/types/messages';
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
	ConversationScrollButton,
} from '@/components/ui/conversation';
import { checkIsAgentGenerating, isToolUIPart } from '@/lib/ai';
import { cn, isLast } from '@/lib/utils';
import { useAgentContext } from '@/contexts/agent.provider';
import { useHeight } from '@/hooks/use-height';
import { groupMessages } from '@/lib/messages.utils';

const DEBUG_MESSAGES = false;

export function ChatMessages() {
	const chatId = useParams({ strict: false }).chatId;
	const contentRef = useRef<HTMLDivElement>(null);
	const containerHeight = useHeight(contentRef, [chatId]);

	return (
		<div
			className='h-full min-h-0 flex animate-fade-in'
			ref={contentRef}
			style={{ '--container-height': `${containerHeight}px` } as React.CSSProperties}
			key={chatId}
		>
			<Conversation>
				<ConversationContent className='max-w-3xl mx-auto'>
					<ChatMessagesContent />
				</ConversationContent>

				<ConversationScrollButton />
			</Conversation>
		</div>
	);
}

const ChatMessagesContent = () => {
	const { messages, status, isRunning, registerScrollDown } = useAgentContext();
	const { scrollToBottom } = useStickToBottomContext();
	const isGenerating = checkIsAgentGenerating(status, messages);

	useEffect(() => {
		// Register the scroll down fn so the agent context has access to it.
		const scrollDownSubscription = registerScrollDown(scrollToBottom);
		return () => {
			scrollDownSubscription.dispose();
		};
	}, [registerScrollDown, scrollToBottom]);

	const messageGroups = useMemo(() => groupMessages(messages), [messages]);

	return (
		<>
			{messageGroups.length === 0 ? (
				<ConversationEmptyState />
			) : (
				messageGroups.map((group) => (
					<MessageGroup
						key={group.user.id}
						group={group}
						showResponseLoader={isLast(group, messageGroups) && isRunning && !isGenerating}
					/>
				))
			)}
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

			{showResponseLoader && !group.responses.length && <AgentMessageLoader className='p-0' />}
		</div>
	);
}

function MessageBlock({ message, showResponseLoader }: { message: UIMessage; showResponseLoader: boolean }) {
	const isUser = message.role === 'user';

	if (DEBUG_MESSAGES) {
		return (
			<div
				className={cn(
					'flex gap-3',
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
	const { isRunning } = useAgentContext();

	if (!message.parts.length && !showResponseLoader) {
		return null;
	}

	return (
		<div className={cn('group px-3 flex flex-col gap-2 bg-transparent')}>
			{message.parts.map((p, i) => {
				const isPartStreaming = 'state' in p && p.state === 'streaming';
				if (isToolUIPart(p)) {
					return <ToolCall key={i} toolPart={p} />;
				}

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

			{!isRunning && (
				<MessageActions
					message={message}
					className='opacity-0 group-last/message:opacity-100 group-hover:opacity-100 transition-opacity duration-200'
				/>
			)}
		</div>
	);
};
