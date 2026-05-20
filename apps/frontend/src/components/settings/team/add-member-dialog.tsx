import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { ChevronDown } from 'lucide-react';
import { USER_ROLES } from '@nao/shared/types';
import type { UserRole } from '@nao/shared/types';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface AddMemberDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title?: string;
	availableRoles?: readonly UserRole[];
	defaultRole?: UserRole;
	onSubmit: (data: { email: string; name?: string; role: UserRole }) => Promise<{ needsName?: boolean }>;
}

export function AddMemberDialog({
	open,
	onOpenChange,
	title = 'Add Member',
	availableRoles,
	defaultRole = 'user',
	onSubmit,
}: AddMemberDialogProps) {
	const [error, setError] = useState('');
	const [needsName, setNeedsName] = useState(false);
	const showRolePicker = availableRoles !== undefined && availableRoles.length > 0;

	const form = useForm({
		defaultValues: { email: '', name: '', role: defaultRole },
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
					role: value.role,
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

	const roles = availableRoles ?? USER_ROLES;

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

					{showRolePicker && (
						<form.Field name='role'>
							{(field) => (
								<div className='flex flex-col gap-2'>
									<label htmlFor='member-role' className='text-sm font-medium'>
										Role
									</label>
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button
												id='member-role'
												variant='outline'
												className='w-full justify-between'
											>
												<span className='capitalize'>{field.state.value}</span>
												<ChevronDown className='h-4 w-4 opacity-50' />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align='start' className='w-full'>
											{roles.map((role) => (
												<DropdownMenuItem
													key={role}
													onClick={() => field.handleChange(role)}
													className={field.state.value === role ? 'bg-accent' : ''}
												>
													<span className='capitalize'>{role}</span>
												</DropdownMenuItem>
											))}
										</DropdownMenuContent>
									</DropdownMenu>
								</div>
							)}
						</form.Field>
					)}

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
