import { useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import type { FeedbackVote } from '@/components/chat-messages/assistant-message-actions';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAgentContext, useAgentMessagesSelector } from '@/contexts/agent.provider';
import { useLicenseFeatures } from '@/hooks/use-license';
import { useIsCloud } from '@/hooks/use-nao-mode';
import { findLastAssistantMessageWithContent } from '@/lib/ai';
import { isConversationFeedbackNavigationAllowed } from '@/lib/conversation-feedback-navigation';
import { trpc } from '@/main';

export function ConversationFeedbackGuard({ chatId }: { chatId: string }) {
	const { isReadonly, isRunning, mode } = useAgentContext();
	const message = useAgentMessagesSelector(findLastAssistantMessageWithContent);
	const agentSettings = useQuery(trpc.project.getAgentSettings.queryOptions());
	const features = useLicenseFeatures();
	const isCloud = useIsCloud();
	const shouldCollect =
		!isCloud &&
		features.data?.['conversation-feedback'] === true &&
		agentSettings.data?.requireConversationFeedback === true &&
		!isReadonly &&
		mode !== 'onboarding' &&
		!!chatId;
	const isEnforced = agentSettings.data?.enforceConversationFeedbackBeforeLeaving === true;
	const needsFeedback = !!message && !message.feedback;
	const navigationBlocker = useBlocker({
		shouldBlockFn: ({ next }) => {
			const staysInConversation = next.pathname === `/${chatId}` || next.pathname.startsWith(`/${chatId}/`);
			if (staysInConversation || isConversationFeedbackNavigationAllowed(chatId)) {
				return false;
			}
			return isRunning ? isEnforced : needsFeedback;
		},
		enableBeforeUnload: false,
		disabled: !shouldCollect,
		withResolver: true,
	});
	const submitFeedback = useMutation(
		trpc.feedback.submit.mutationOptions({
			onSuccess: (data, variables, _, ctx) => {
				ctx.client.setQueryData(trpc.chat.get.queryKey({ chatId: variables.chatId }), (previous) =>
					previous
						? {
								...previous,
								messages: previous.messages.map((candidate) =>
									candidate.id === variables.messageId ? { ...candidate, feedback: data } : candidate,
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
				if (navigationBlocker.status === 'blocked') {
					navigationBlocker.proceed();
				}
			},
		}),
	);

	useEffect(() => {
		if (navigationBlocker.status === 'blocked' && !isRunning && !needsFeedback) {
			navigationBlocker.proceed();
		}
	}, [isRunning, navigationBlocker, needsFeedback]);

	const handleVote = (vote: FeedbackVote) => {
		if (!message) {
			return;
		}
		submitFeedback.mutate({ chatId, messageId: message.id, vote });
	};

	const handleOpenChange = (open: boolean) => {
		if (!open && !submitFeedback.isPending && navigationBlocker.status === 'blocked') {
			if (isEnforced) {
				navigationBlocker.reset();
			} else {
				navigationBlocker.proceed();
			}
		}
	};

	return (
		<Dialog
			open={navigationBlocker.status === 'blocked' && !isRunning && needsFeedback}
			onOpenChange={handleOpenChange}
		>
			<DialogContent showCloseButton={false} className='sm:max-w-sm'>
				<div className='flex items-center justify-between gap-4'>
					<DialogHeader className='text-left'>
						<DialogTitle>How did it go?</DialogTitle>
						<DialogDescription className='sr-only'>
							{isEnforced
								? 'Rate the latest answer to continue.'
								: 'Rate the latest answer or skip to continue.'}
						</DialogDescription>
					</DialogHeader>
					<div className='flex shrink-0 gap-1'>
						{!isEnforced && (
							<Button
								variant='ghost'
								size='sm'
								className='rounded-full text-muted-foreground'
								onClick={navigationBlocker.proceed}
								disabled={submitFeedback.isPending}
							>
								Skip
							</Button>
						)}
						<Button
							variant='ghost'
							size='icon'
							className='rounded-full'
							onClick={() => handleVote('up')}
							disabled={submitFeedback.isPending}
							aria-label='Good conversation'
						>
							<ThumbsUp />
						</Button>
						<Button
							variant='ghost'
							size='icon'
							className='rounded-full'
							onClick={() => handleVote('down')}
							disabled={submitFeedback.isPending}
							aria-label='Bad conversation'
						>
							<ThumbsDown />
						</Button>
					</div>
				</div>
				{submitFeedback.isError && (
					<p className='text-sm text-destructive'>Feedback could not be submitted. Please try again.</p>
				)}
			</DialogContent>
		</Dialog>
	);
}
