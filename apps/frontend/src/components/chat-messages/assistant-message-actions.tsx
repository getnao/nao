import { useState } from 'react';
import { ThumbsUp, ThumbsDown, Copy, Check } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import type { UIMessage } from '@nao/backend/chat';
import type { FormEvent, KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { trpc } from '@/main';
import { cn } from '@/lib/utils';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { getMessageText } from '@/lib/ai';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

export function AssistantMessageActions({
	message,
	className,
	chatId,
}: {
	message: UIMessage;
	className?: string;
	chatId: string;
}) {
	const [feedbackDialogVote, setFeedbackDialogVote] = useState<FeedbackVote>('down');
	const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
	const { isCopied, copy } = useCopyToClipboard();

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
				void ctx.client.invalidateQueries({
					queryKey: trpc.project.getChatReplay.queryKey({ chatId }),
				});
				void ctx.client.invalidateQueries({
					queryKey: trpc.project.getProjectChats.queryKey(),
				});
			},
		}),
	);

	const handlePositiveFeedbackClick = () => {
		setFeedbackDialogVote('up');
		setFeedbackDialogOpen(true);
	};

	const handleNegativeFeedbackClick = () => {
		setFeedbackDialogVote('down');
		setFeedbackDialogOpen(true);
	};

	const handleFeedbackSubmit = (explanation?: string) => {
		submitFeedback.mutate({
			chatId,
			messageId: message.id,
			vote: feedbackDialogVote,
			explanation,
		});
		setFeedbackDialogOpen(false);
	};

	return (
		<>
			<div className={cn('flex items-center gap-1', className)}>
				<Button
					variant='ghost'
					size='icon-sm'
					onClick={handlePositiveFeedbackClick}
					disabled={submitFeedback.isPending}
					className={cn(
						'hover:rounded-full',
						message.feedback?.vote === 'up' ? 'text-primary' : 'opacity-50 hover:opacity-100',
					)}
					aria-label='Good response'
				>
					<ThumbsUp className='size-4' />
				</Button>

				<Button
					variant='ghost'
					size='icon-sm'
					onClick={handleNegativeFeedbackClick}
					disabled={submitFeedback.isPending}
					className={cn(
						'hover:rounded-full',
						message.feedback?.vote === 'down' ? 'text-primary' : 'opacity-50 hover:opacity-100',
					)}
					aria-label='Bad response'
				>
					<ThumbsDown className='size-4' />
				</Button>

				<Button
					variant='ghost'
					size='icon-sm'
					onClick={() => copy(getMessageText(message))}
					className='opacity-50 hover:opacity-100 hover:rounded-full'
					aria-label='Copy message'
				>
					{isCopied ? <Check className='size-4' /> : <Copy className='size-4' />}
				</Button>
			</div>

			<FeedbackDialog
				open={feedbackDialogOpen}
				onOpenChange={setFeedbackDialogOpen}
				onSubmit={handleFeedbackSubmit}
				isPending={submitFeedback.isPending}
				vote={feedbackDialogVote}
			/>
		</>
	);
}

export type FeedbackVote = 'up' | 'down';

interface FeedbackDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (explanation?: string) => void;
	isPending: boolean;
	vote: FeedbackVote;
}

export function FeedbackDialog({ open, onOpenChange, onSubmit, isPending, vote }: FeedbackDialogProps) {
	const [explanation, setExplanation] = useState('');
	const isPositive = vote === 'up';

	const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		onSubmit(explanation.trim() || undefined);
		setExplanation('');
	};

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen) {
			setExplanation('');
		}
		onOpenChange(nextOpen);
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			e.currentTarget.form?.requestSubmit();
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent showCloseButton>
				<DialogHeader>
					<DialogTitle>{isPositive ? 'What went well?' : 'What went wrong?'}</DialogTitle>
					<DialogDescription className='text-sm text-muted-foreground font-medium'>
						{isPositive
							? 'Help us improve by explaining what worked well with this response.'
							: 'Help us improve by explaining what was wrong with this response.'}
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className='flex flex-col gap-4'>
					<Textarea
						placeholder={
							isPositive
								? 'Tell us what worked well (optional)'
								: 'Tell us what could be better (optional)'
						}
						value={explanation}
						onKeyDown={handleKeyDown}
						onChange={(e) => setExplanation(e.target.value)}
						rows={4}
						className='resize-none bg-panel'
					/>

					<Button variant='primary-gradient' className='rounded-full' type='submit' disabled={isPending}>
						Submit
					</Button>
				</form>
			</DialogContent>
		</Dialog>
	);
}
