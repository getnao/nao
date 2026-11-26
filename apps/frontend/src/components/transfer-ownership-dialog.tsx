import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export const MISSING_TABLE_ACCESS_REASON = 'Missing access to some tables';
export const NO_ELIGIBLE_RECIPIENT_MESSAGE =
	'No other member can access all the tables the current owner can. Add a member to the groups that grant these tables, then try again.';

export interface TransferRecipient {
	id: string;
	name: string;
	email: string;
}

export interface TransferCandidate extends TransferRecipient {
	hasTableAccess: boolean;
}

interface TransferOwnershipDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: ReactNode;
	recipients: TransferCandidate[] | undefined;
	canTransfer?: boolean;
	hasNothingToTransfer?: boolean;
	isPending: boolean;
	error?: string;
	onTransfer: (recipientId: string) => void;
}

export function TransferOwnershipDialog({
	open,
	onOpenChange,
	title,
	description,
	recipients,
	canTransfer = true,
	hasNothingToTransfer = false,
	isPending,
	error,
	onTransfer,
}: TransferOwnershipDialogProps) {
	const [recipientId, setRecipientId] = useState('');
	const hasEligibleRecipient = recipients?.some((recipient) => recipient.hasTableAccess) ?? false;

	useEffect(() => {
		if (open) {
			setRecipientId('');
		}
	}, [open]);

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen && isPending) {
			return;
		}
		onOpenChange(nextOpen);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className='sm:max-w-md'>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				{hasNothingToTransfer ? (
					<DialogFooter>
						<Button
							type='button'
							variant='ghost'
							className='rounded-full border'
							onClick={() => handleOpenChange(false)}
						>
							Close
						</Button>
					</DialogFooter>
				) : (
					<form
						className='grid gap-4'
						onSubmit={(event) => {
							event.preventDefault();
							if (recipientId) {
								onTransfer(recipientId);
							}
						}}
					>
						<div className='grid gap-2'>
							<label htmlFor='transfer-ownership-recipient' className='text-sm font-medium'>
								New owner
							</label>
							<Select value={recipientId} onValueChange={setRecipientId} disabled={!hasEligibleRecipient}>
								<SelectTrigger id='transfer-ownership-recipient' size='input'>
									<SelectValue placeholder={recipients ? 'Choose a member' : 'Loading members…'} />
								</SelectTrigger>
								<SelectContent>
									{recipients?.map((recipient) => (
										<SelectItem
											key={recipient.id}
											value={recipient.id}
											disabled={!recipient.hasTableAccess}
										>
											<span className='truncate'>{recipient.name}</span>
											<span className='truncate text-xs text-muted-foreground'>
												{recipient.hasTableAccess
													? recipient.email
													: MISSING_TABLE_ACCESS_REASON}
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{recipients?.length === 0 && (
								<p className='text-xs text-muted-foreground'>
									No other member who can edit is available.
								</p>
							)}
							{!!recipients?.length && !hasEligibleRecipient && (
								<p className='text-xs text-muted-foreground'>{NO_ELIGIBLE_RECIPIENT_MESSAGE}</p>
							)}
						</div>
						{error && (
							<p className='text-sm text-destructive' role='alert'>
								{error}
							</p>
						)}
						<DialogFooter>
							<Button
								type='button'
								variant='ghost'
								className='rounded-full border'
								disabled={isPending}
								onClick={() => handleOpenChange(false)}
							>
								Cancel
							</Button>
							<Button
								type='submit'
								variant='primary-gradient'
								className='rounded-full'
								disabled={!recipientId || !canTransfer || isPending}
								isLoading={isPending}
							>
								Transfer
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
