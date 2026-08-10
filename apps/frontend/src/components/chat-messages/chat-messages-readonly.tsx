import { memo, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { filterSupersededExecuteSqlParts } from '@nao/shared/execute-sql-parts';
import { UserMessageBubble } from './user-message';
import type { StickToBottomContext } from 'use-stick-to-bottom';
import type { ForkMetadata, UIMessage } from '@nao/backend/chat';
import { SelectionCitationExcerpt } from '@/components/selection-citation-excerpt';
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
	forkMetadata,
	conversationContextRef,
	feedbackRecommendations,
}: {
	messages: UIMessage[];
	className?: string;
	forkMetadata?: ForkMetadata;
	conversationContextRef?: React.Ref<StickToBottomContext>;
	feedbackRecommendations?: FeedbackRecommendationMap;
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
		const rawText = forkMetadata.selectionText;
		const text = rawText.length > 200 ? `${rawText.slice(0, 200)}\u2026` : rawText;
		const citationLabel = `@chars ${forkMetadata.selectionStart}–${forkMetadata.selectionEnd}`;
		return { id: isForkedMessage.id, citation: citationLabel, text };
	}, [messages, forkMetadata]);

	return (
		<div className={cn('h-full min-h-0 flex', className)}>
			<Conversation contextRef={conversationContextRef}>
				<ConversationContent className='max-w-3xl mx-auto gap-0' data-selection-container>
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
}: {
	userMessage: UIMessage | null;
	assistantMessages: UIMessage[];
	citation: { id: string; citation: string; text: string } | null;
	feedbackRecommendations?: FeedbackRecommendationMap;
}) => {
	const messages = userMessage ? [userMessage, ...assistantMessages] : assistantMessages;
	return (
		<div className='flex flex-col gap-4 last:mb-4'>
			{messages.map((message) => (
				<MessageBlockReadonly
					key={message.id}
					message={message}
					citation={citation}
					feedbackRecommendations={feedbackRecommendations}
				/>
			))}
		</div>
	);
};

const MessageBlockReadonly = ({
	message,
	citation,
	feedbackRecommendations,
}: {
	message: UIMessage;
	citation: { id: string; citation: string; text: string } | null;
	feedbackRecommendations?: FeedbackRecommendationMap;
}) => {
	if (message.isForked && citation?.id === message.id) {
		return <CitationBlockReadonly citation={citation} />;
	}

	if (message.role === 'user') {
		return <UserMessageReadonly message={message} />;
	}

	return <AssistantMessageReadonly message={message} linkedRecommendation={feedbackRecommendations?.[message.id]} />;
};

const UserMessageReadonly = memo(({ message }: { message: UIMessage }) => {
	return (
		<div className='flex flex-col gap-2 items-end w-full p-2' data-replay-target-id={message.id}>
			<UserMessageBubble message={message} />
		</div>
	);
});

const AssistantMessageReadonly = memo(
	({
		message,
		linkedRecommendation,
	}: {
		message: UIMessage;
		linkedRecommendation?: { id: string; title: string; status: string };
	}) => {
		const [toolCallDensity] = useToolCallDensity();
		const messageParts = useMemo(
			() => groupToolCalls(message.parts, toolCallDensity),
			[message.parts, toolCallDensity],
		);
		const hasContent = useMemo(() => checkAssistantMessageHasContent(message), [message]);
		const isCompacting = message.parts.at(-1)?.type === 'data-compactionSummaryStarted';

		if (!message.parts.length) {
			return null;
		}

		return (
			<AssistantMessageProvider isSettled={true}>
				<div className={cn('group px-3 flex flex-col gap-2 bg-transparent')} data-replay-target-id={message.id}>
					<MessageParts parts={messageParts} />

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
							{message.feedback.vote === 'down' &&
								message.feedback.explanation != null &&
								message.feedback.explanation.trim() !== '' && (
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

const CitationBlockReadonly = ({ citation }: { citation: { id: string; citation: string; text: string } }) => {
	return (
		<div className='px-4 py-3 border border-border bg-background shrink-0 rounded-xl'>
			<SelectionCitationExcerpt label={citation.citation} text={citation.text} maxLength={0} />
		</div>
	);
};
