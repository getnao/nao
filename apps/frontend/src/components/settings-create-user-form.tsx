import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

interface ModifyUserInfoProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onUserCreated: (email: string, password: string) => void;
}

export function CreateUserForm({ open, onOpenChange, onUserCreated }: ModifyUserInfoProps) {
	const { refetch } = useSession();
	const queryClient = useQueryClient();

	const [formData, setFormData] = useState({
		name: '',
		email: '',
	});
	const [error, setError] = useState('');

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setFormData({
			...formData,
			[e.target.name]: e.target.value,
		});
	};

	const createUserAndAddToProject = useMutation(
		trpc.user.createUserAndAddToProject.mutationOptions({
			onSuccess: async (ctx) => {
				await refetch();
				await queryClient.invalidateQueries({
					queryKey: trpc.project.getAllUsersWithRoles.queryKey(),
				});
				onOpenChange(false);
				onUserCreated(formData.email, ctx.password);
			},
			onError: (err) => {
				setError(err.message);
			},
		}),
	);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError('');

		await createUserAndAddToProject.mutateAsync({
			email: formData.email,
			name: formData.name,
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create User</DialogTitle>
				</DialogHeader>
				<div className='flex flex-col gap-4'>
					<div className='flex flex-col gap-2'>
						<label htmlFor='name' className='text-sm font-medium text-slate-700'>
							Name
						</label>
						<Input
							id='name'
							name='name'
							type='text'
							placeholder="Enter the new user's name"
							value={formData.name}
							onChange={handleChange}
						/>
					</div>
				</div>
				<div className='flex flex-col gap-4'>
					<div className='flex flex-col gap-2'>
						<label htmlFor='email' className='text-sm font-medium text-slate-700'>
							Email
						</label>
						<Input
							id='email'
							name='email'
							type='text'
							placeholder="Enter the new user's email"
							value={formData.email}
							onChange={handleChange}
						/>
					</div>
				</div>
				{error && <p className='text-red-500 text-center text-base'>{error}</p>}
				<div className='flex justify-end'>
					<Button onClick={handleSubmit}>Create user</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
