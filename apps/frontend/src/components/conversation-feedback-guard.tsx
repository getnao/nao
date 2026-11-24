import { useBlocker } from '@tanstack/react-router';
import type { FeedbackVote } from '@/components/chat-messages/assistant-message-actions';

import { FeedbackDialog } from '@/components/chat-messages/assistant-message-actions';
import { useAgentContext, useAgentMessagesSelector } from '@/contexts/agent.provider';
import { useIsConversationFeedbackRequired, useSubmitMessageFeedback } from '@/hooks/use-message-feedback';
import { findLastAssistantMessageWithContent } from '@/lib/ai';
import { isConversationFeedbackNavigationAllowed } from '@/lib/conversation-feedback-navigation';

export function ConversationFeedbackGuard({ chatId }: { chatId: string }) {
	const { isRunning } = useAgentContext();
	const message = useAgentMessagesSelector(findLastAssistantMessageWithContent);
	const isFeedbackRequired = useIsConversationFeedbackRequired();
	const needsFeedback = !!message && !message.feedback;
	const navigationBlocker = useBlocker({
		shouldBlockFn: ({ next }) => {
			const staysInConversation = next.pathname === `/${chatId}` || next.pathname.startsWith(`/${chatId}/`);
			if (staysInConversation || isConversationFeedbackNavigationAllowed(chatId)) {
				return false;
			}
			return !isRunning && needsFeedback;
		},
		enableBeforeUnload: false,
		disabled: !isFeedbackRequired || !chatId,
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

	const handleOpenChange = (open: boolean) => {
		if (!open) {
			stayInConversation();
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
			onOpenChange={handleOpenChange}
			onSubmit={handleSubmit}
			onSkip={leaveConversation}
			isPending={submitFeedback.isPending}
			error={submitFeedback.isError ? "Couldn't send your feedback. Try again or skip." : undefined}
			subject='conversation'
		/>
	);
}
