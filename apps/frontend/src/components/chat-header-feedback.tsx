import { useState } from 'react';
import { useBlocker } from '@tanstack/react-router';
import type { UIMessage } from '@nao/backend/chat';
import type { FeedbackVote } from '@/components/chat-messages/assistant-message-actions';

import { FEEDBACK_VOTES, FeedbackButton, FeedbackDialog } from '@/components/chat-messages/assistant-message-actions';
import { useAgentContext, useAgentMessagesSelector } from '@/contexts/agent.provider';
import { useIsConversationFeedbackRequired, useSubmitMessageFeedback } from '@/hooks/use-message-feedback';
import { checkAssistantMessageHasContent } from '@/lib/ai';
import { isConversationFeedbackNavigationAllowed } from '@/lib/conversation-feedback-navigation';

export function ChatHeaderFeedback({ chatId }: { chatId: string }) {
	const [dialogVote, setDialogVote] = useState<FeedbackVote>('down');
	const [isDialogOpen, setIsDialogOpen] = useState(false);
	const [celebration, setCelebration] = useState<{ vote: FeedbackVote; key: number } | null>(null);
	const { isRunning } = useAgentContext();
	const message = useAgentMessagesSelector(findLastAssistantMessageWithContent);
	const isFeedbackRequired = useIsConversationFeedbackRequired();
	const submitFeedback = useSubmitMessageFeedback((vote) => {
		setCelebration((previous) => ({ vote, key: (previous?.key ?? 0) + 1 }));
		setIsDialogOpen(false);
	});

	if (!isFeedbackRequired || !message) {
		return null;
	}

	const openDialog = (vote: FeedbackVote) => {
		submitFeedback.reset();
		setDialogVote(vote);
		setIsDialogOpen(true);
	};

	const handleSubmit = (explanation: string | undefined, vote: FeedbackVote) => {
		submitFeedback.mutate({ chatId, messageId: message.id, vote, explanation });
	};

	return (
		<>
			<div className='flex items-center' aria-label='Conversation feedback'>
				{FEEDBACK_VOTES.map((vote) => (
					<FeedbackButton
						key={vote}
						vote={vote}
						subject='conversation'
						isSelected={message.feedback?.vote === vote}
						celebrationKey={celebration?.vote === vote ? celebration.key : undefined}
						disabled={isRunning || submitFeedback.isPending}
						onClick={() => openDialog(vote)}
					/>
				))}
			</div>
			<FeedbackDialog
				open={isDialogOpen}
				onOpenChange={setIsDialogOpen}
				onSubmit={handleSubmit}
				isPending={submitFeedback.isPending}
				error={submitFeedback.isError ? "Couldn't send your feedback. Please try again." : undefined}
				defaultVote={dialogVote}
				subject='conversation'
			/>
		</>
	);
}

export function ConversationFeedbackGuard({ chatId }: { chatId: string }) {
	const { isRunning } = useAgentContext();
	const message = useAgentMessagesSelector(findLastAssistantMessageWithContent);
	const isFeedbackRequired = useIsConversationFeedbackRequired();
	const navigationBlocker = useBlocker({
		shouldBlockFn: ({ next }) => {
			const staysInConversation = next.pathname === `/${chatId}` || next.pathname.startsWith(`/${chatId}/`);
			if (staysInConversation || isConversationFeedbackNavigationAllowed(chatId)) {
				return false;
			}
			return !isRunning && !!message && !message.feedback;
		},
		enableBeforeUnload: false,
		disabled: !isFeedbackRequired,
		withResolver: true,
	});
	const submitFeedback = useSubmitMessageFeedback(() => leaveConversation());

	const leaveConversation = () => {
		submitFeedback.reset();
		if (navigationBlocker.status === 'blocked') {
			navigationBlocker.proceed();
		}
	};

	const stayInConversation = () => {
		submitFeedback.reset();
		if (navigationBlocker.status === 'blocked') {
			navigationBlocker.reset();
		}
	};

	const handleSubmit = (explanation: string | undefined, vote: FeedbackVote) => {
		if (message) {
			submitFeedback.mutate({ chatId, messageId: message.id, vote, explanation });
		}
	};

	return (
		<FeedbackDialog
			open={navigationBlocker.status === 'blocked'}
			onOpenChange={(open) => !open && stayInConversation()}
			onSubmit={handleSubmit}
			onSkip={leaveConversation}
			isPending={submitFeedback.isPending}
			error={submitFeedback.isError ? "Couldn't send your feedback. Try again or skip." : undefined}
			subject='conversation'
		/>
	);
}

function findLastAssistantMessageWithContent(messages: UIMessage[]): UIMessage | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role === 'assistant' && checkAssistantMessageHasContent(message)) {
			return message;
		}
	}
	return undefined;
}
