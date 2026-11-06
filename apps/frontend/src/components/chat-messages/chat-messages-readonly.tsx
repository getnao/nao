import { memo, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { filterSupersededExecuteSqlParts } from '@nao/shared/execute-sql-parts';
import { UserMessageBubble } from './user-message';
import type { StickToBottomContext } from 'use-stick-to-bottom';
import type { ForkMetadata, MessageModel, UIMessage } from '@nao/backend/chat';
import type { CitationData } from '@nao/shared/types';
import { CitationPill } from '@/components/citation-pill';
import { MessageModelLabel } from '@/components/chat-messages/message-model-label';
import { AnswerDuration, MessageDateTime } from '@/components/chat-messages/message-timing';
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
import { useToolCallDensity } from '@/hooks/use-tool-call-density';

export type FeedbackRecommendationMap = Record<string, { id: string; title: string; status: string }>;
export type MessageModelMap = Record<string, MessageModel>;

function recommendationTabForStatus(status: string): 'recommendations' | 'applied' | 'dismissed' {
	if (status === 'applied') {
		return 'applied';
	}
	if (status === 'dismissed') {
		return 'dismissed';
	}
	return 'recommendations';
}

export function ChatMessagesReadonly({
	messages,
	className,
	contentClassName,
	forkMetadata,
	conversationContextRef,
	feedbackRecommendations,
	messageModels,
	showTimestamps = false,
}: {
	messages: UIMessage[];
	className?: string;
	contentClassName?: string;
	forkMetadata?: ForkMetadata;
	conversationContextRef?: React.Ref<StickToBottomContext>;
	feedbackRecommendations?: FeedbackRecommendationMap;
	messageModels?: MessageModelMap;
	showTimestamps?: boolean;
}) {
	const messageGroups = useMemo(() => groupMessages(filterSupersededExecuteSqlParts(messages)), [messages]);

	const citation = useMemo(() => {
		if (!forkMetadata?.selectionText || forkMetadata.selectionStart == null || forkMetadata.selectionEnd == null) {
			return null;
		}
		const isForkedMessage = [...messages].reverse().find((m: UIMessage) => m.isForked === true);
		if (!isForkedMessage) {
			return null;
		}
		return {
			id: isForkedMessage.id,
			start: forkMetadata.selectionStart,
			end: forkMetadata.selectionEnd,
			text: forkMetadata.selectionText,
		};
	}, [messages, forkMetadata]);

	return (
		<div className={cn('h-full min-h-0 flex', className)}>
			<Conversation contextRef={conversationContextRef}>
				<ConversationContent
					className={cn('max-w-3xl mx-auto gap-0', contentClassName)}
					data-selection-container
				>
					{messageGroups.length === 0 ? (
						<ConversationEmptyState title='No messages' description='' />
					) : (
						messageGroups.map((group) => (
							<MessageGroupReadonly
								key={group.userMessage?.id ?? group.assistantMessages[0]?.id}
								userMessage={group.userMessage}
								assistantMessages={group.assistantMessages}
								citation={citation}
								feedbackRecommendations={feedbackRecommendations}
								messageModels={messageModels}
								showTimestamps={showTimestamps}
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
	citation,
	feedbackRecommendations,
	messageModels,
	showTimestamps,
}: {
	userMessage: UIMessage | null;
	assistantMessages: UIMessage[];
	citation: ForkCitation | null;
	feedbackRecommendations?: FeedbackRecommendationMap;
	messageModels?: MessageModelMap;
	showTimestamps: boolean;
}) => {
	const messages = userMessage ? [userMessage, ...assistantMessages] : assistantMessages;
	return (
		<div className='flex flex-col gap-4 last:mb-4'>
			{messages.map((message, index) => (
				<MessageBlockReadonly
					key={message.id}
					message={message}
					previousMessage={messages[index - 1]}
					citation={citation}
					feedbackRecommendations={feedbackRecommendations}
					messageModels={messageModels}
					showTimestamps={showTimestamps}
				/>
			))}
		</div>
	);
};

const MessageBlockReadonly = ({
	message,
	previousMessage,
	citation,
	feedbackRecommendations,
	messageModels,
	showTimestamps,
}: {
	message: UIMessage;
	previousMessage: UIMessage | undefined;
	citation: ForkCitation | null;
	feedbackRecommendations?: FeedbackRecommendationMap;
	messageModels?: MessageModelMap;
	showTimestamps: boolean;
}) => {
	if (message.isForked && citation?.id === message.id) {
		return <CitationBlockReadonly citation={citation} />;
	}

	const showTimestamp = showTimestamps && hasOriginalTimestamp(message);

	if (message.role === 'user') {
		return <UserMessageReadonly message={message} showTimestamp={showTimestamp} />;
	}

	return (
		<AssistantMessageReadonly
			message={message}
			linkedRecommendation={feedbackRecommendations?.[message.id]}
			model={messageModels?.[message.id]}
			answerStartedAt={
				previousMessage && hasOriginalTimestamp(previousMessage) ? previousMessage.createdAt : undefined
			}
			showTimestamp={showTimestamp}
		/>
	);
};

/** Forked messages are copies stamped with the fork time, so their timestamps say nothing about the original chat. */
function hasOriginalTimestamp(message: UIMessage): boolean {
	return !message.isForked;
}

const UserMessageReadonly = memo(({ message, showTimestamp }: { message: UIMessage; showTimestamp: boolean }) => {
	return (
		<div className='flex flex-col gap-2 items-end w-full p-2' data-replay-target-id={message.id}>
			<UserMessageBubble message={message} />
			{showTimestamp && message.createdAt != null && (
				<MessageDateTime timestamp={message.createdAt} className='px-1 text-xs text-muted-foreground' />
			)}
		</div>
	);
});

const AssistantMessageReadonly = memo(
	({
		message,
		linkedRecommendation,
		model,
		answerStartedAt,
		showTimestamp,
	}: {
		message: UIMessage;
		linkedRecommendation?: { id: string; title: string; status: string };
		model?: MessageModel;
		answerStartedAt: number | undefined;
		showTimestamp: boolean;
	}) => {
		const [toolCallDensity] = useToolCallDensity();
		const messageParts = useMemo(
			() => groupToolCalls(message.parts, toolCallDensity),
			[message.parts, toolCallDensity],
		);
		const hasContent = useMemo(() => checkAssistantMessageHasContent(message), [message]);
		const isCompacting = message.parts.at(-1)?.type === 'data-compactionSummaryStarted';
		const finishedAt = showTimestamp ? message.createdAt : undefined;

		if (!message.parts.length) {
			return null;
		}

		return (
			<AssistantMessageProvider isSettled={true}>
				<div className={cn('group px-3 flex flex-col gap-2 bg-transparent')} data-replay-target-id={message.id}>
					<MessageParts parts={messageParts} />

					{(model || finishedAt != null) && (
						<div className='flex items-center gap-1.5 text-xs text-muted-foreground'>
							{model && <MessageModelLabel model={model} />}
							{model && finishedAt != null && <span aria-hidden>·</span>}
							{finishedAt != null && (
								<AnswerDuration startedAt={answerStartedAt} finishedAt={finishedAt} />
							)}
						</div>
					)}

					{message.feedback && (
						<div
							data-replay-nav='feedback'
							data-replay-bordered='true'
							data-replay-nav-vote={message.feedback.vote}
							className='flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground mt-1 p-1'
						>
							{message.feedback.vote === 'up' ? (
								<ThumbsUp className='size-3.5 text-green-600 dark:text-green-400' />
							) : (
								<ThumbsDown className='size-3.5 text-red-500 dark:text-red-400' />
							)}
							<span>Feedback</span>
							{message.feedback.explanation != null && message.feedback.explanation.trim() !== '' && (
								<span className='text-xs font-semibold'> : {message.feedback.explanation}</span>
							)}
							{message.feedback.vote === 'down' && linkedRecommendation && (
								<Link
									to='/settings/recommendations'
									search={{
										openChats: linkedRecommendation.id,
										tab: recommendationTabForStatus(linkedRecommendation.status),
									}}
									className='ml-1 text-primary underline-offset-4 hover:underline'
								>
									View recommendation
								</Link>
							)}
						</div>
					)}

					{!hasContent && <div className='text-muted-foreground italic text-sm'>No response</div>}

					{isCompacting && <AssistantCompaction />}
				</div>
			</AssistantMessageProvider>
		);
	},
);

type ForkCitation = CitationData & { id: string };

const CitationBlockReadonly = ({ citation }: { citation: ForkCitation }) => {
	return (
		<div className='flex shrink-0 justify-end'>
			<CitationPill citation={citation} />
		</div>
	);
};
