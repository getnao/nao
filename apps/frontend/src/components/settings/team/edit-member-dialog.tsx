import { useState, useEffect } from 'react';
import { useForm } from '@tanstack/react-form';
import { ChevronDown } from 'lucide-react';
import { USER_ROLES } from '@nao/shared/types';
import type { UserRole } from '@nao/shared/types';

import type { TeamMember } from './types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface EditMemberDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	member: TeamMember | null;
	isAdmin: boolean;
	availableRoles?: readonly UserRole[];
	onSubmit: (data: { userId: string; name?: string; newRole?: UserRole }) => Promise<void>;
}

export function EditMemberDialog({
	open,
	onOpenChange,
	member,
	isAdmin,
	availableRoles = USER_ROLES,
	onSubmit,
}: EditMemberDialogProps) {
	const [error, setError] = useState('');

	const form = useForm({
		defaultValues: {
			name: member?.name ?? '',
			role: member?.role ?? 'user',
		},
		onSubmit: async ({ value }) => {
			if (!member) {
				return;
			}
			setError('');
			try {
				await onSubmit({
					userId: member.id,
					name: value.name,
					newRole: value.role,
				});
				onOpenChange(false);
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			}
		},
	});

	useEffect(() => {
		if (open && member) {
			form.reset();
			form.setFieldValue('name', member.name);
			form.setFieldValue('role', member.role);
		}
	}, [open, member, form]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit Profile</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						form.handleSubmit();
					}}
					className='flex flex-col gap-4'
				>
					<form.Field name='name'>
						{(field) => (
							<div className='flex flex-col gap-2'>
								<label htmlFor='edit-member-name' className='text-sm font-medium'>
									Name
								</label>
								<Input
									id='edit-member-name'
									type='text'
									placeholder='Name'
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
								/>
							</div>
						)}
					</form.Field>

					{isAdmin && (
						<form.Field name='role'>
							{(field) => (
								<div className='flex flex-col gap-2'>
									<label htmlFor='edit-member-role' className='text-sm font-medium'>
										Role
									</label>
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button variant='outline' className='w-full justify-between'>
												<span className='capitalize'>{field.state.value}</span>
												<ChevronDown className='h-4 w-4 opacity-50' />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align='start' className='w-full'>
											{availableRoles.map((role) => (
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

					{error && <p className='text-red-500 text-center text-sm'>{error}</p>}
					<div className='flex justify-end'>
						<Button type='submit'>Validate changes</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
