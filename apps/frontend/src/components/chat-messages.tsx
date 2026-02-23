import { Streamdown } from 'streamdown';
import { Check, Copy, Pencil } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useParams, useRouterState } from '@tanstack/react-router';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { ToolCall } from './tool-calls';
import { ToolCallsGroup } from './tool-calls/tool-calls-group';
import { ReasoningAccordion } from './chat-message-reasoning-accordion';
import { TextShimmer } from './ui/text-shimmer';
import { MessageActions } from './chat-message-actions';
import { ChatError } from './chat-error';
import { FollowUpSuggestions } from './chat-follow-up-suggestions';
import { ChatInputInline } from './chat-input';
import type { UIMessage } from '@nao/backend/chat';
import type { MessageGroup } from '@/types/ai';
import {
	groupMessages,
	isToolUIPart,
	checkIsAgentGenerating,
	groupToolCalls,
	isToolGroupPart,
	getLastFollowUpSuggestionsToolCall,
	getMessageText,
} from '@/lib/ai';
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
import { Button } from '@/components/ui/button';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { messageEditStore, useIsEditingMessage } from '@/hooks/use-message-edit-store';
import { useClickOutside } from '@/hooks/use-click-outside';

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
				<ConversationContent className='max-w-3xl mx-auto gap-0'>
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
	const followUpSuggestionsToolCall = useMemo(() => getLastFollowUpSuggestionsToolCall(messages), [messages]);
	const extraComponentsRef = useRef<HTMLDivElement>(null);
	const extraComponentsHeight = useHeight(extraComponentsRef);

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
	const debouncedIsWaitingForAgentContentGeneration = useDebounceValue(isWaitingForAgentContentGeneration, {
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
							key={group.user.id}
							group={group}
							showResponseLoader={
								isLast(group, messageGroups) && debouncedIsWaitingForAgentContentGeneration
							}
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
};

function MessageGroup({ group, showResponseLoader }: { group: MessageGroup; showResponseLoader: boolean }) {
	return (
		<div className='flex flex-col gap-4 last:min-h-[calc(var(--container-height)-var(--extra-components-height)-calc(2*24px+16px))] group/message last:mb-4'>
			{[group.user, ...group.responses].map((message) => (
				<MessageBlock
					key={message.id}
					message={message}
					showResponseLoader={showResponseLoader && isLast(message, group.responses)}
				/>
			))}

			{showResponseLoader && !group.responses.length && <TextShimmer className='px-3' />}
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
	const { isRunning, editMessage } = useAgentContext();
	const { isCopied, copy } = useCopyToClipboard();
	const isEditing = useIsEditingMessage(message.id);
	const editContainerRef = useRef<HTMLDivElement>(null);
	const text = useMemo(() => getMessageText(message), [message]);

	useClickOutside(
		{
			ref: editContainerRef,
			enabled: isEditing,
			onClickOutside: () => messageEditStore.setEditing(null),
		},
		[isEditing],
	);

	if (isEditing) {
		return (
			<div ref={editContainerRef}>
				<ChatInputInline
					initialText={text}
					className='p-0 **:data-[slot=input-group]:shadow-none!'
					onCancel={() => messageEditStore.setEditing(null)}
					onSubmitMessage={async ({ text: nextText }) => {
						messageEditStore.setEditing(null);
						await editMessage({ messageId: message.id, text: nextText });
					}}
				/>
			</div>
		);
	}

	return (
		<div className='group flex flex-col gap-2'>
			<div className={cn('rounded-2xl px-3 py-2 bg-card text-card-foreground ml-auto max-w-xl border')}>
				<span className='whitespace-pre-wrap wrap-break-word'>{text}</span>
			</div>

			<div
				className={cn(
					'ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200',
					isRunning && 'group-last:opacity-0 invisible',
				)}
			>
				<Button variant='ghost-muted' size='icon-sm' onClick={() => messageEditStore.setEditing(message.id)}>
					<Pencil />
				</Button>
				<Button variant='ghost-muted' size='icon-sm' onClick={() => copy(getMessageText(message))}>
					{isCopied ? <Check className='size-4' /> : <Copy />}
				</Button>
			</div>
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
	const isSettled = !isRunning || !isLastMessage;
	const hasText = useMemo(() => message.parts.some((p) => p.type === 'text'), [message.parts]);

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

				if (isToolUIPart(p) && p.type !== 'tool-suggest_follow_ups') {
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

			{isSettled && !hasText && <div className='text-muted-foreground italic text-sm'>No response</div>}

			{showResponseLoader && <TextShimmer />}

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
