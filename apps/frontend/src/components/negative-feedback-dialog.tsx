import { useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface NegativeFeedbackDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (explanation?: string) => void;
	isPending: boolean;
}

export function NegativeFeedbackDialog({ open, onOpenChange, onSubmit, isPending }: NegativeFeedbackDialogProps) {
	const [explanation, setExplanation] = useState('');

	const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		onSubmit(explanation.trim() || undefined);
		setExplanation('');
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			onSubmit(explanation.trim() || undefined);
			setExplanation('');
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
