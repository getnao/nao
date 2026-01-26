import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { GeneratePassword } from 'js-generate-password';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

interface ModifyUserInfoProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onUserCreated: (email: string, password: string) => void;
	initialName?: string;
	initialEmail?: string;
	initialPicture?: string;
}

export function CreateUserForm({ open, onOpenChange, onUserCreated }: ModifyUserInfoProps) {
	const { refetch } = useSession();
	const [formData, setFormData] = useState({
		name: '',
		email: '',
		password: '',
	});
	const [error, setError] = useState('');
	const project = useQuery(trpc.project.getCurrent.queryOptions());

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setFormData({
			...formData,
			[e.target.name]: e.target.value,
		});
	};

	const createUser = useMutation(
		trpc.user.createUser.mutationOptions({
			onSuccess: async () => {
				await refetch();
			},
			onError: () => {
				setError('An error occurred while updating the profile.');
			},
		}),
	);

	const addMemberToProject = useMutation(
		trpc.project.addMemberToProject.mutationOptions({
			onSuccess: async () => {
				await refetch();
				onOpenChange(false);
			},
			onError: () => {
				setError('An error occurred while updating the profile.');
			},
		}),
	);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError('');
		formData.password = GeneratePassword({
			length: 14,
			symbols: true,
		});

		const newUser = await createUser.mutateAsync({
			email: formData.email,
			password: formData.password,
			name: formData.name,
		});

		await addMemberToProject.mutateAsync({
			userId: newUser.id,
			projectId: project.data?.id || '',
			role: 'user',
		});
		onUserCreated(formData.email, formData.password);
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
							placeholder='newuser'
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
							placeholder='newuser@gmail.com'
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
