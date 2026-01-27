import { useState } from 'react';
import { Check, Copy, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface NewlyCreatedUserDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	email: string;
	password: string;
}

export function NewlyCreatedUserDialog({ open, onOpenChange, email, password }: NewlyCreatedUserDialogProps) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(password);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='max-w-md'>
				<DialogHeader>
					<DialogTitle>User Created Successfully</DialogTitle>
				</DialogHeader>

				<div className='space-y-4'>
					<div className='flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg'>
						<AlertTriangle className='size-5 text-amber-500 shrink-0 mt-0.5' />
						<p className='text-sm text-amber-700 dark:text-amber-400'>
							Make sure to save this password. You won't be able to see it again after closing this
							dialog.
						</p>
					</div>

					<div className='space-y-2'>
						<label className='text-sm font-medium text-slate-700 dark:text-slate-300'>Email</label>
						<div className='px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700'>
							<p className='font-mono text-sm text-slate-900 dark:text-slate-100'>{email}</p>
						</div>
					</div>

					<div className='space-y-2'>
						<label className='text-sm font-medium text-slate-700 dark:text-slate-300'>Password</label>
						<div className='flex items-center gap-2'>
							<div className='flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700'>
								<p className='font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 break-all'>
									{password}
								</p>
							</div>
							<Button
								variant='outline'
								size='icon'
								onClick={handleCopy}
								className='shrink-0'
								title='Copy password'
							>
								{copied ? <Check className='size-4 text-green-500' /> : <Copy className='size-4' />}
							</Button>
						</div>
					</div>

					<div className='flex justify-end gap-2 pt-2'>
						<Button variant='default' onClick={() => onOpenChange(false)}>
							Done
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
