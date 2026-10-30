import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { formatBillingDate, formatBillingPrice } from '@/lib/billing-display';

export type CloudBillingChangePreview = {
	amountDue: number;
	subtotal: number;
	tax: number;
	discount: number;
	currency: string;
	lines: Array<{
		description: string;
		amount: number;
		currency: string;
		proration: boolean;
		periodStartsAt: Date | null;
		periodEndsAt: Date | null;
	}>;
	previewToken: string;
	expiresAt: Date;
	effective: 'immediate' | 'period_end';
	effectiveAt: Date;
	readOnlyUsersAfterChange: Array<{ userId: string; name: string; email: string }>;
} | null;

export function CloudBillingChangeDialog({
	open,
	onOpenChange,
	title,
	preview,
	onRefresh,
	onConfirm,
	onFixPayment,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	preview: CloudBillingChangePreview;
	onRefresh: () => Promise<unknown>;
	onConfirm?: (previewToken: string) => Promise<unknown>;
	onFixPayment?: () => void;
}) {
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const expired = preview ? preview.expiresAt.getTime() <= Date.now() : false;

	const confirm = async () => {
		if (!preview || !onConfirm) {
			return;
		}
		setIsPending(true);
		setError(null);
		try {
			await onConfirm(preview.previewToken);
		} catch (caught) {
			const message = caught instanceof Error ? caught.message : 'Unable to apply this billing change.';
			setError(message);
			if (message.toLowerCase().includes('preview')) {
				await onRefresh();
			}
		} finally {
			setIsPending(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='max-h-[calc(100vh-2rem)] overflow-y-auto'>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>Stripe calculated these amounts for this exact change.</DialogDescription>
				</DialogHeader>
				{preview && (
					<div className='space-y-4'>
						<p className='text-sm'>
							Effective{' '}
							{preview.effective === 'immediate' ? 'immediately' : formatBillingDate(preview.effectiveAt)}
						</p>
						<ul className='divide-y divide-border rounded-lg border border-border'>
							{preview.lines.map((line, index) => (
								<li
									key={`${line.description}:${index}`}
									className='flex justify-between gap-4 p-3 text-sm'
								>
									<span>
										{line.description}
										{line.proration && (
											<span className='block text-xs text-muted-foreground'>Proration</span>
										)}
									</span>
									<span className='font-medium'>
										{formatBillingPrice(line.amount, line.currency)}
									</span>
								</li>
							))}
						</ul>
						<dl className='grid grid-cols-2 gap-2 text-sm'>
							<dt>Subtotal</dt>
							<dd className='text-right'>{formatBillingPrice(preview.subtotal, preview.currency)}</dd>
							<dt>Discounts</dt>
							<dd className='text-right'>−{formatBillingPrice(preview.discount, preview.currency)}</dd>
							<dt>Tax</dt>
							<dd className='text-right'>{formatBillingPrice(preview.tax, preview.currency)}</dd>
							<dt className='font-semibold'>Due now</dt>
							<dd className='text-right font-semibold'>
								{formatBillingPrice(preview.amountDue, preview.currency)}
							</dd>
						</dl>
						{preview.readOnlyUsersAfterChange.length > 0 && (
							<div>
								<p className='text-sm font-medium'>People who will become read-only</p>
								<ul className='mt-1 text-sm text-muted-foreground'>
									{preview.readOnlyUsersAfterChange.map((user) => (
										<li key={user.userId}>{user.name}</li>
									))}
								</ul>
							</div>
						)}
						{expired && (
							<p className='text-sm text-amber-600' role='status'>
								This preview expired. Refresh it before confirming.
							</p>
						)}
					</div>
				)}
				{error && (
					<div className='space-y-2' role='alert'>
						<p className='text-sm text-destructive'>{error}</p>
						{onFixPayment && /payment|authentication/i.test(error) && (
							<Button variant='secondary' size='sm' onClick={onFixPayment}>
								Fix payment method in Stripe
							</Button>
						)}
					</div>
				)}
				<DialogFooter>
					<Button variant='secondary' onClick={() => onOpenChange(false)} disabled={isPending}>
						Cancel
					</Button>
					{expired ? (
						<Button onClick={() => void onRefresh()}>Refresh preview</Button>
					) : (
						onConfirm && (
							<Button onClick={() => void confirm()} isLoading={isPending} disabled={!preview}>
								Confirm change
							</Button>
						)
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
