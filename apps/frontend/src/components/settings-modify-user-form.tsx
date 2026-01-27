import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpc } from '@/main';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/auth-client';

interface ModifyUserInfoProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	userId: string | null;
	isAdmin: boolean;
}

export function ModifyUserForm({ open, onOpenChange, userId, isAdmin }: ModifyUserInfoProps) {
	const { refetch } = useSession();
	const [error, setError] = useState('');
	const userQuery = useQuery(trpc.user.get.queryOptions({ userId: userId || '' }, { enabled: !!userId && open }));
	const user = userQuery.data;
	const queryClient = useQueryClient();

	useEffect(() => {
		if (user) {
			setUserData({
				name: user.name || '',
				previousPassword: '',
				newPassword: '',
			});
		}
	}, [user]);

	const [userData, setUserData] = useState({
		name: user?.name || '',
		previousPassword: '',
		newPassword: '',
	});

	const modifyUser = useMutation(
		trpc.user.modify.mutationOptions({
			onSuccess: async () => {
				await refetch();
				await queryClient.invalidateQueries({
					queryKey: trpc.project.getAllUsersWithRoles.queryKey(),
				});
				onOpenChange(false);
			},
			onError: (err) => {
				setError(err.message || 'An error occurred while updating the profile.');
			},
		}),
	);

	const handleValidate = async () => {
		setError('');

		await modifyUser.mutateAsync({
			userId: userId || '',
			name: userData.name,
			previousPassword: userData.previousPassword || undefined,
			newPassword: userData.newPassword || undefined,
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit Profile</DialogTitle>
				</DialogHeader>
				<div className='flex flex-col gap-4'>
					<div className='flex flex-col gap-2'>
						<label htmlFor='name' className='text-sm font-medium text-slate-700'>
							Name
						</label>
						<Input
							id='name'
							type='text'
							placeholder='Your name'
							value={userData.name}
							onChange={(e) => setUserData({ ...userData, name: e.target.value })}
						/>
					</div>
				</div>
				{isAdmin && (
					<>
						<div className='flex flex-col gap-4'>
							<div className='flex flex-col gap-2'>
								<label htmlFor='previousPassword' className='text-sm font-medium text-slate-700'>
									Previous Password
								</label>
								<Input
									id='previousPassword'
									type='password'
									placeholder='Your previous password'
									value={userData.previousPassword}
									onChange={(e) => setUserData({ ...userData, previousPassword: e.target.value })}
								/>
							</div>
						</div>
						<div className='flex flex-col gap-4'>
							<div className='flex flex-col gap-2'>
								<label htmlFor='newPassword' className='text-sm font-medium text-slate-700'>
									New Password
								</label>
								<Input
									id='newPassword'
									type='password'
									placeholder='Your new password'
									value={userData.newPassword}
									onChange={(e) => setUserData({ ...userData, newPassword: e.target.value })}
								/>
							</div>
						</div>
					</>
				)}
				{error && <p className='text-red-500 text-center text-base'>{error}</p>}
				<div className='flex justify-end'>
					<Button onClick={handleValidate}>Validate changes</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
