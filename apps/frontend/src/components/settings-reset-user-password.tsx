import { useMutation } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useUserPageContext } from '@/contexts/user.provider';
import { trpc } from '@/main';

export function ResetPasswordDialog() {
	const {
		userInfo,
		isResetUserPasswordOpen,
		setIsResetUserPasswordOpen,
		setNewUser,
		setIsNewUserDialogOpen,
		error,
		setError,
	} = useUserPageContext();

	const resetUserPassword = useMutation(
		trpc.account.resetPassword.mutationOptions({
			onSuccess: (ctx) => {
				setNewUser({ email: userInfo.email || '', password: ctx.password });
				setIsNewUserDialogOpen(true);
			},
			onError: (err) => {
				setError(err.message);
			},
		}),
	);

	const handleReset = async () => {
		setError('');
		await resetUserPassword.mutateAsync({
			userId: userInfo.id || '',
		});
		setIsResetUserPasswordOpen(false);
	};

	return (
		<Dialog open={isResetUserPasswordOpen} onOpenChange={setIsResetUserPasswordOpen}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Reset {userInfo.name}'s password?</DialogTitle>
				</DialogHeader>
				<div className='flex flex-col gap-4'>
					<p className='text-sm text-muted-foreground'>Are you sure you want to do this?</p>
				</div>
				{error && <p className='text-red-500 text-center text-base'>{error}</p>}
				<div className='flex justify-end gap-2'>
					<Button variant='outline' onClick={() => setIsResetUserPasswordOpen(false)}>
						Cancel
					</Button>
					<Button variant='destructive' onClick={handleReset}>
						Reset password
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
