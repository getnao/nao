import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { trpc } from '@/main';
import { useUserPageContext } from '@/contexts/user.provider';

export function AddUserDialog() {
	const { isAddUserFormOpen, setIsAddUserFormOpen, setNewUser, setIsNewUserDialogOpen, error, setError } =
		useUserPageContext();
	const [needToCreateUser, setNeedToCreateUser] = useState(false);

	const addUserToProject = useMutation(
		trpc.user.addUserToProject.mutationOptions({
			onSuccess: (data, variables, _, ctx) => {
				ctx.client.setQueryData(trpc.project.getAllUsersWithRoles.queryKey(), (oldData: any) => {
					if (!data.newUser) {
						return oldData;
					}
					return [...(oldData || []), data.newUser];
				});
				handleClose();

				if (data.password) {
					setNewUser({ email: variables.email, password: data.password });
					setIsNewUserDialogOpen(true);
				}
			},
			onError: (err) => {
				if (err.message === 'USER_DOES_NOT_EXIST') {
					setNeedToCreateUser(true);
				} else {
					setError(err.message);
				}
			},
		}),
	);

	const form = useForm({
		defaultValues: { email: '', name: '' },
		onSubmit: ({ value }) => {
			setError('');

			if (needToCreateUser) {
				addUserToProject.mutate({ email: value.email, name: value.name });
			} else {
				addUserToProject.mutate({ email: value.email });
			}
		},
	});

	const handleClose = () => {
		setIsAddUserFormOpen(false);
		setNeedToCreateUser(false);
		form.reset();
	};

	return (
		<Dialog open={isAddUserFormOpen} onOpenChange={handleClose}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add User</DialogTitle>
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
						<form.Field name='email'>
							{(field) => (
								<div className='flex flex-col gap-2'>
									<label htmlFor='email' className='text-sm font-medium text-slate-700'>
										Email
									</label>
									<Input
										id='email'
										name='email'
										type='email'
										placeholder="Enter the user's email"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
									/>
								</div>
							)}
						</form.Field>
					</div>
					{needToCreateUser && (
						<>
							<div className='flex flex-col gap-4'>
								<form.Field name='name'>
									{(field) => (
										<div className='flex flex-col gap-2'>
											<label htmlFor='name' className='text-sm font-medium text-slate-700'>
												Name
											</label>
											<Input
												id='name'
												name='name'
												type='text'
												placeholder="Enter the user's name"
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
											/>
										</div>
									)}
								</form.Field>
							</div>
							<div className='text-sm font-medium text-slate-700'>
								Add a name in order to create a new user, no one was found with the provided email.
							</div>
						</>
					)}
					{error && <p className='text-red-500 text-center text-base'>{error}</p>}
					<div className='flex justify-end'>
						<Button type='submit'>Add user</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
