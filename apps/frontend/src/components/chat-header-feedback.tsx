import { useState } from 'react';
import type { FeedbackVote } from '@/components/chat-messages/assistant-message-actions';

import { FEEDBACK_VOTES, FeedbackButton, FeedbackDialog } from '@/components/chat-messages/assistant-message-actions';
import { useAgentContext, useAgentMessagesSelector } from '@/contexts/agent.provider';
import { useIsConversationFeedbackRequired, useSubmitMessageFeedback } from '@/hooks/use-message-feedback';
import { findLastAssistantMessageWithContent } from '@/lib/ai';

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
