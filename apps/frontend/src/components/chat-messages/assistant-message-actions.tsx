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
	const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
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
					onClick={() => copy(getMessageText(message))}
					className='opacity-50 hover:opacity-100'
					aria-label='Copy message'
				>
					{isCopied ? <Check className='size-4' /> : <Copy className='size-4' />}
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

interface NegativeFeedbackDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (explanation?: string) => void;
	isPending: boolean;
}

function NegativeFeedbackDialog({ open, onOpenChange, onSubmit, isPending }: NegativeFeedbackDialogProps) {
	const [explanation, setExplanation] = useState('');

	const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		onSubmit(explanation.trim() || undefined);
		setExplanation('');
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			e.currentTarget.form?.requestSubmit();
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent showCloseButton>
				<DialogHeader>
					<DialogTitle>What went wrong?</DialogTitle>
					<DialogDescription>
						Help us improve by explaining what was wrong with this response.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className='flex flex-col gap-4'>
					<Textarea
						placeholder='Tell us what could be better (optional)'
						value={explanation}
						onKeyDown={handleKeyDown}
						onChange={(e) => setExplanation(e.target.value)}
						rows={4}
						className='resize-none'
					/>

					<Button type='submit' disabled={isPending}>
						Submit
					</Button>
				</form>
			</DialogContent>
		</Dialog>
	);
}
