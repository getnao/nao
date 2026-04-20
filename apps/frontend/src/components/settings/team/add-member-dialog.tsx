import { useState } from 'react';
import { useForm } from '@tanstack/react-form';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface AddMemberDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title?: string;
	onSubmit: (data: { email: string; name?: string }) => Promise<{ needsName?: boolean }>;
}

export function AddMemberDialog({ open, onOpenChange, title = 'Add Member', onSubmit }: AddMemberDialogProps) {
	const [error, setError] = useState('');
	const [needsName, setNeedsName] = useState(false);

	const form = useForm({
		defaultValues: { email: '', name: '' },
		onSubmit: async ({ value }) => {
			setError('');
			if (needsName && !value.name.trim()) {
				setError('Name is required to create a new user.');
				return;
			}
			try {
				const result = await onSubmit({
					email: value.email,
					name: needsName ? value.name : undefined,
				});
				if (result.needsName) {
					setNeedsName(true);
				} else {
					handleClose();
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			}
		},
	});

	const handleClose = () => {
		onOpenChange(false);
		setError('');
		setNeedsName(false);
		form.reset();
	};

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						form.handleSubmit();
					}}
					className='flex flex-col gap-4'
				>
					<form.Field name='email'>
						{(field) => (
							<div className='flex flex-col gap-2'>
								<label htmlFor='member-email' className='text-sm font-medium'>
									Email
								</label>
								<Input
									id='member-email'
									type='email'
									placeholder="Enter the user's email"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
								/>
							</div>
						)}
					</form.Field>

					{needsName && (
						<>
							<form.Field name='name'>
								{(field) => (
									<div className='flex flex-col gap-2'>
										<label htmlFor='member-name' className='text-sm font-medium'>
											Name
										</label>
										<Input
											id='member-name'
											type='text'
											placeholder="Enter the user's name"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
										/>
									</div>
								)}
							</form.Field>
							<p className='text-sm text-muted-foreground'>
								No account found with this email. Enter a name to create a new user.
							</p>
						</>
					)}

					{error && <p className='text-red-500 text-center text-sm'>{error}</p>}
					<div className='flex justify-end'>
						<Button type='submit'>Add member</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
