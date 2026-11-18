import { useMutation, useQuery } from '@tanstack/react-query';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { FeedbackVote } from '@/components/chat-messages/assistant-message-actions';

import { FeedbackDialog } from '@/components/chat-messages/assistant-message-actions';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAgentContext, useAgentMessagesSelector } from '@/contexts/agent.provider';
import { useLicenseFeatures } from '@/hooks/use-license';
import { useIsCloud } from '@/hooks/use-nao-mode';
import { findLastAssistantMessageWithContent } from '@/lib/ai';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export function ChatHeaderFeedback({ chatId }: { chatId: string }) {
	const [dialogVote, setDialogVote] = useState<FeedbackVote>('down');
	const [isDialogOpen, setIsDialogOpen] = useState(false);
	const { isReadonly, isRunning, mode } = useAgentContext();
	const message = useAgentMessagesSelector(findLastAssistantMessageWithContent);
	const agentSettings = useQuery(trpc.project.getAgentSettings.queryOptions());
	const features = useLicenseFeatures();
	const isCloud = useIsCloud();
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
				setIsDialogOpen(false);
			},
		}),
	);

	const isLicensed = features.data?.['conversation-feedback'] === true;
	const isEnabled = agentSettings.data?.requireConversationFeedback === true;

	if (isCloud || !isLicensed || !isEnabled || isReadonly || mode === 'onboarding' || !message) {
		return null;
	}

	const openDialog = (vote: FeedbackVote) => {
		setDialogVote(vote);
		setIsDialogOpen(true);
	};

	const handleSubmit = (explanation?: string) => {
		submitFeedback.mutate({
			chatId,
			messageId: message.id,
			vote: dialogVote,
			explanation,
		});
	};

	return (
		<>
			<div className='flex items-center' aria-label='Conversation feedback'>
				<HeaderFeedbackButton
					Icon={ThumbsUp}
					label='Good conversation'
					isActive={message.feedback?.vote === 'up'}
					activeClassName='text-green-500/80 bg-green-500/10'
					disabled={isRunning || submitFeedback.isPending}
					onClick={() => openDialog('up')}
				/>
				<HeaderFeedbackButton
					Icon={ThumbsDown}
					label='Bad conversation'
					isActive={message.feedback?.vote === 'down'}
					activeClassName='text-red-500/80 bg-red-500/10'
					disabled={isRunning || submitFeedback.isPending}
					onClick={() => openDialog('down')}
				/>
			</div>
			<FeedbackDialog
				open={isDialogOpen}
				onOpenChange={setIsDialogOpen}
				onSubmit={handleSubmit}
				isPending={submitFeedback.isPending}
				vote={dialogVote}
				subject='conversation'
			/>
		</>
	);
}

interface HeaderFeedbackButtonProps {
	Icon: LucideIcon;
	label: string;
	isActive: boolean;
	activeClassName: string;
	disabled: boolean;
	onClick: () => void;
}

function HeaderFeedbackButton({
	Icon,
	label,
	isActive,
	activeClassName,
	disabled,
	onClick,
}: HeaderFeedbackButtonProps) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant='ghost'
					size='icon-sm'
					className={cn('hover:rounded-full', isActive ? activeClassName : 'opacity-50 hover:opacity-100')}
					onClick={onClick}
					disabled={disabled}
					aria-label={label}
					aria-pressed={isActive}
				>
					<Icon className='size-4' strokeWidth={1.75} />
				</Button>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}
