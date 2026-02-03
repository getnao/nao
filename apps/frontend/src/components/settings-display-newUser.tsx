import { useState } from 'react';
import { Check, Copy, AlertTriangle, Mail } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useUserPageContext } from '@/contexts/user.provider';

export function NewUserDialog() {
	const { isNewUserDialogOpen, setIsNewUserDialogOpen, newUser } = useUserPageContext();
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		if (newUser?.password) {
			await navigator.clipboard.writeText(newUser.password);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	};

	return (
		<Dialog open={isNewUserDialogOpen} onOpenChange={setIsNewUserDialogOpen}>
			<DialogContent className='max-w-md'>
				<div className='space-y-4'>
					<div className='flex items-start gap-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg mt-5'>
						<Mail className='size-5 text-blue-500 shrink-0 mt-0.5' />
						<p className='text-sm text-blue-700 dark:text-blue-400'>
							If setup, an email has been sent to the user.
						</p>
					</div>

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
							<p className='font-mono text-sm text-slate-900 dark:text-slate-100'>{newUser?.email}</p>
						</div>
					</div>

					<div className='space-y-2'>
						<label className='text-sm font-medium text-slate-700 dark:text-slate-300'>Password</label>
						<div className='flex items-center gap-2'>
							<div className='flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700'>
								<p className='font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 break-all'>
									{newUser?.password}
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
						<Button variant='default' onClick={() => setIsNewUserDialogOpen(false)}>
							Done
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
