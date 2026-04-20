import { useState } from 'react';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface RemoveMemberDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	memberName: string;
	description?: string;
	onConfirm: () => Promise<void>;
}

export function RemoveMemberDialog({
	open,
	onOpenChange,
	memberName,
	description = 'Are you sure you want to remove this user?',
	onConfirm,
}: RemoveMemberDialogProps) {
	const [error, setError] = useState('');

	const handleConfirm = async () => {
		setError('');
		try {
			await onConfirm();
			onOpenChange(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Remove {memberName}?</DialogTitle>
				</DialogHeader>
				<p className='text-sm text-muted-foreground'>{description}</p>
				{error && <p className='text-red-500 text-center text-sm'>{error}</p>}
				<div className='flex justify-end gap-2'>
					<Button variant='outline' onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button variant='destructive' onClick={handleConfirm}>
						Remove
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
