import { useMutation } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useUserPageContext } from '@/contexts/user.provider';
import { trpc } from '@/main';

export function RemoveUserDialog() {
	const { userInfo, isRemoveUserFromProjectOpen, setIsRemoveUserFromProjectOpen, error, setError } =
		useUserPageContext();

	const removeProjectMember = useMutation(
		trpc.project.removeProjectMember.mutationOptions({
			onSuccess: (data, _, __, ctx) => {
				ctx.client.setQueryData(trpc.project.getAllUsersWithRoles.queryKey(), (oldData: any) => {
					return (oldData || []).filter((user: any) => user.id !== userInfo.id);
				});
				setIsRemoveUserFromProjectOpen(false);
			},
			onError: (err) => {
				setError(err.message);
			},
		}),
	);

	const handleRemove = async () => {
		setError('');
		await removeProjectMember.mutateAsync({
			userId: userInfo.id || '',
		});
	};

	return (
		<Dialog open={isRemoveUserFromProjectOpen} onOpenChange={setIsRemoveUserFromProjectOpen}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Remove {userInfo.name} from project?</DialogTitle>
				</DialogHeader>
				<div className='flex flex-col gap-4'>
					<p className='text-sm text-muted-foreground'>
						Are you sure you want to remove this user from the project?
					</p>
				</div>
				{error && <p className='text-red-500 text-center text-base'>{error}</p>}
				<div className='flex justify-end gap-2'>
					<Button variant='outline' onClick={() => setIsRemoveUserFromProjectOpen(false)}>
						Cancel
					</Button>
					<Button variant='destructive' onClick={handleRemove}>
						Remove user
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
