import { useMutation, useQuery } from '@tanstack/react-query';
import type { FeedbackVote } from '@/components/chat-messages/assistant-message-actions';
import { useAgentContext } from '@/contexts/agent.provider';
import { useLicenseFeatures } from '@/hooks/use-license';
import { useIsCloud } from '@/hooks/use-nao-mode';
import { trpc } from '@/main';

export function useSubmitMessageFeedback(onSuccess?: (vote: FeedbackVote) => void) {
	return useMutation(
		trpc.feedback.submit.mutationOptions({
			onSuccess: (data, variables, _, ctx) => {
				ctx.client.setQueryData(trpc.chat.get.queryKey({ chatId: variables.chatId }), (previous) =>
					previous
						? {
								...previous,
								messages: previous.messages.map((message) =>
									message.id === variables.messageId ? { ...message, feedback: data } : message,
								),
							}
						: previous,
				);
				void ctx.client.invalidateQueries({
					queryKey: trpc.project.getChatReplay.queryKey({ chatId: variables.chatId }),
				});
				void ctx.client.invalidateQueries({
					queryKey: trpc.project.getProjectChats.queryKey(),
				});
				onSuccess?.(variables.vote);
			},
		}),
	);
}

export function useIsConversationFeedbackRequired(): boolean {
	const { isReadonly, mode } = useAgentContext();
	const agentSettings = useQuery(trpc.project.getAgentSettings.queryOptions());
	const features = useLicenseFeatures();
	const isCloud = useIsCloud();

	return (
		!isCloud &&
		features.data?.['conversation-feedback'] === true &&
		agentSettings.data?.requireConversationFeedback === true &&
		!isReadonly &&
		mode !== 'onboarding'
	);
}
