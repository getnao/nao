import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function ModifyPassword() {
	const { refetch } = useSession();
	const { data: sessionData } = useSession();
	const [newPassword, setNewPassword] = useState('');
	const [confirmPassword, setConfirmPassword] = useState('');
	const [error, setError] = useState('');

	const modifyUserPassword = useMutation(
		trpc.account.modifyPassword.mutationOptions({
			onSuccess: async () => {
				await refetch();
			},
			onError: (err) => {
				setError(err.message);
			},
		}),
	);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError('');

		if (!sessionData?.user?.id) {
			setError('User not found');
			return;
		}

		if (newPassword !== confirmPassword) {
			setError('Passwords do not match');
			return;
		}

		await modifyUserPassword.mutateAsync({
			userId: sessionData.user.id,
			newPassword: newPassword,
			confirmPassword: confirmPassword,
		});
	};

	return (
		<div className='h-screen w-full flex items-center justify-center'>
			<div className='container mx-auto w-full max-w-2xl p-12'>
				<div className='text-3xl font-bold mb-4 text-center'>Reset Your Password</div>
				<div className='mb-4 text-center'>
					First-time login or password reset?
					<br /> Change your password to secure your account!
				</div>
				<form onSubmit={handleSubmit} className='space-y-6'>
					<Input
						name='newPassword'
						type='password'
						placeholder='New Password'
						value={newPassword}
						onChange={(e) => setNewPassword(e.target.value)}
						required
						className='h-12 text-base'
					/>

					<Input
						name='confirmPassword'
						type='password'
						placeholder='Confirm New Password'
						value={confirmPassword}
						onChange={(e) => setConfirmPassword(e.target.value)}
						required
						className='h-12 text-base'
					/>

					{error && <p className='text-red-500 text-center text-base'>{error}</p>}

					<Button
						type='submit'
						className='w-full h-12 text-base'
						disabled={!newPassword || !confirmPassword || modifyUserPassword.isPending}
					>
						{modifyUserPassword.isPending ? 'Updating...' : 'Reset Password'}
					</Button>
				</form>
			</div>
		</div>
	);
}
