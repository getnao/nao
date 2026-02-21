import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuItem, DropdownMenuContent, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { trpc } from '@/main';
import { useSession } from '@/lib/auth-client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useUserPageContext } from '@/contexts/user.provider';

interface ModifyUserInfoProps {
	isAdmin: boolean;
}

export function ModifyUserForm({ isAdmin }: ModifyUserInfoProps) {
	const { userInfo, isModifyUserFormOpen, setIsModifyUserFormOpen, error, setError } = useUserPageContext();
	const { refetch } = useSession();
	const queryClient = useQueryClient();

	const modifyUser = useMutation(
		trpc.user.modify.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: trpc.project.getAllUsersWithRoles.queryKey(),
				});
				await refetch();
				setIsModifyUserFormOpen(false);
			},
			onError: (err) => {
				setError(err.message || 'An error occurred while updating the profile.');
			},
		}),
	);

	const form = useForm({
		defaultValues: {
			name: userInfo.name,
			role: userInfo.role,
		},
		onSubmit: async ({ value }) => {
			setError('');

			await modifyUser.mutateAsync({
				userId: userInfo.id || '',
				name: value.name,
				newRole: value.role,
			});
		},
	});

	useEffect(() => {
		if (isModifyUserFormOpen) {
			form.reset();
			form.setFieldValue('name', userInfo.name);
			form.setFieldValue('role', userInfo.role);
		}
	}, [isModifyUserFormOpen, userInfo, form]);

	return (
		<Dialog open={isModifyUserFormOpen} onOpenChange={setIsModifyUserFormOpen}>
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
					<div className='flex flex-col gap-4'>
						<form.Field name='name'>
							{(field) => (
								<div className='flex flex-col gap-2'>
									<label htmlFor='name' className='text-sm font-medium text-slate-700'>
										Name
									</label>
									<Input
										id='name'
										type='text'
										placeholder='Your name'
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
										<label htmlFor='role' className='text-sm font-medium text-slate-700'>
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
												<DropdownMenuItem
													onClick={() => field.handleChange('admin')}
													className={field.state.value === 'admin' ? 'bg-accent' : ''}
												>
													Admin
												</DropdownMenuItem>
												<DropdownMenuItem
													onClick={() => field.handleChange('user')}
													className={field.state.value === 'user' ? 'bg-accent' : ''}
												>
													User
												</DropdownMenuItem>
												<DropdownMenuItem
													onClick={() => field.handleChange('viewer')}
													className={field.state.value === 'viewer' ? 'bg-accent' : ''}
												>
													Viewer
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
								)}
							</form.Field>
						)}
					</div>

					{error && <p className='text-red-500 text-center text-base'>{error}</p>}
					<div className='flex justify-end'>
						<Button type='submit'>Validate changes</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
