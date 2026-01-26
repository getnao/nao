import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { trpc } from '@/main';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/auth-client';

interface ModifyUserInfoProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	initialName?: string;
	initialEmail?: string;
	initialPicture?: string;
}

export function ModifyUserForm({ open, onOpenChange }: ModifyUserInfoProps) {
	const { data: session, refetch } = useSession();
	const user = session?.user;

	const [name, setName] = useState(user?.name || '');
	const [error, setError] = useState('');

	useEffect(() => {
		setName(user?.name || '');
	}, [open, user?.name]);

	const modifyUser = useMutation(
		trpc.user.modifyUser.mutationOptions({
			onSuccess: async () => {
				await refetch();
				onOpenChange(false);
			},
			onError: () => {
				setError('An error occurred while updating the profile.');
			},
		}),
	);

	const handleValidate = async () => {
		setError('');
		if (user) {
			await modifyUser.mutateAsync({
				userId: user.id,
				name: name,
			});
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit Profile</DialogTitle>
				</DialogHeader>
				<div className='flex flex-col gap-4 py-4'>
					<div className='flex flex-col gap-2'>
						<label htmlFor='name' className='text-sm font-medium text-slate-700'>
							Name
						</label>
						<Input
							id='name'
							type='text'
							placeholder='Your name'
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					</div>
				</div>
				{error && <p className='text-red-500 text-center text-base'>{error}</p>}
				<div className='flex justify-end'>
					<Button onClick={handleValidate}>Validate changes</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
