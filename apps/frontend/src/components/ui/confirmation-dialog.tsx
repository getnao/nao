import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface ConfirmationDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	confirmLabel: string;
	onConfirm: () => void | Promise<void>;
	isPending?: boolean;
	error?: string;
	preventCloseWhilePending?: boolean;
}

export function ConfirmationDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel,
	onConfirm,
	isPending = false,
	error,
	preventCloseWhilePending = false,
}: ConfirmationDialogProps) {
	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen && preventCloseWhilePending && isPending) {
			return;
		}
		onOpenChange(nextOpen);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
				</DialogHeader>
				<DialogDescription className='text-sm text-muted-foreground'>{description}</DialogDescription>
				{error && <p className='text-red-500 text-center text-sm'>{error}</p>}
				<div className='flex justify-end gap-2'>
					<Button
						variant='outline'
						className='rounded-full border'
						disabled={isPending}
						onClick={() => handleOpenChange(false)}
					>
						Cancel
					</Button>
					<Button
						variant='destructive'
						className='rounded-full'
						disabled={isPending}
						isLoading={isPending}
						onClick={onConfirm}
					>
						{confirmLabel}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
