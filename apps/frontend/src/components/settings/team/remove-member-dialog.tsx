import { useState } from 'react';

import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';

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
		<ConfirmationDialog
			open={open}
			onOpenChange={onOpenChange}
			title={`Remove ${memberName}?`}
			description={description}
			confirmLabel='Remove'
			onConfirm={handleConfirm}
			error={error}
		/>
	);
}
