import { useState } from 'react';
import { ThumbsUp, ThumbsDown, Copy, Check } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { NegativeFeedbackDialog } from './chat-negative-feedback-dialog';
import type { UIMessage } from 'backend/chat';
import { Button } from '@/components/ui/button';
import { serializeMessageForCopy } from '@/lib/messages.utils';
import { trpc } from '@/main';
import { cn } from '@/lib/utils';

interface MessageActionsProps {
	message: UIMessage;
	className?: string;
	chatId: string;
}

export function MessageActions({ message, className, chatId }: MessageActionsProps) {
	const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
	const [copied, setCopied] = useState(false);

	const submitFeedback = useMutation(
		trpc.feedback.submit.mutationOptions({
			onSuccess: (data, _, __, ctx) => {
				ctx.client.setQueryData(trpc.chat.get.queryKey({ chatId }), (prev) =>
					prev
						? {
								...prev,
								messages: prev.messages.map((m) =>
									m.id === message.id ? { ...m, feedback: data } : m,
								),
							}
						: prev,
				);
			},
		}),
	);

	const handlePositiveFeedback = () => {
		if (message.feedback?.vote === 'up') {
			return;
		}
		submitFeedback.mutate({
			chatId,
			messageId: message.id,
			vote: 'up',
		});
	};

	const handleNegativeFeedbackClick = () => {
		setShowFeedbackDialog(true);
	};

	const handleNegativeFeedbackSubmit = (explanation?: string) => {
		submitFeedback.mutate({
			chatId,
			messageId: message.id,
			vote: 'down',
			explanation,
		});
		setShowFeedbackDialog(false);
	};

	const handleCopy = async () => {
		const text = serializeMessageForCopy(message);
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<>
			<div className={cn('flex items-center gap-1', className)}>
				<Button
					variant='ghost'
					size='icon-sm'
					onClick={handlePositiveFeedback}
					disabled={submitFeedback.isPending}
					className={cn(message.feedback?.vote === 'up' ? 'text-primary' : 'opacity-50 hover:opacity-100')}
					aria-label='Good response'
				>
					<ThumbsUp className='size-4' />
				</Button>

				<Button
					variant='ghost'
					size='icon-sm'
					onClick={handleNegativeFeedbackClick}
					disabled={submitFeedback.isPending}
					className={cn(message.feedback?.vote === 'down' ? 'text-primary' : 'opacity-50 hover:opacity-100')}
					aria-label='Bad response'
				>
					<ThumbsDown className='size-4' />
				</Button>

				<Button
					variant='ghost'
					size='icon-sm'
					onClick={handleCopy}
					className='opacity-50 hover:opacity-100'
					aria-label='Copy message'
				>
					{copied ? <Check className='size-4' /> : <Copy className='size-4' />}
				</Button>
			</div>

			<NegativeFeedbackDialog
				open={showFeedbackDialog}
				onOpenChange={setShowFeedbackDialog}
				onSubmit={handleNegativeFeedbackSubmit}
				isPending={submitFeedback.isPending}
			/>
		</>
	);
}
