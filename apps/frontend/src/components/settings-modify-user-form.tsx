import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { trpc } from '@/main';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/auth-client';
import { TextField, PasswordField, FormError } from '@/components/ui/form-fields';

interface ModifyUserFormProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	userId: string | null;
	isAdmin: boolean;
}

export function ModifyUserForm({ open, onOpenChange, userId, isAdmin }: ModifyUserFormProps) {
	const { refetch } = useSession();
	const queryClient = useQueryClient();
	const [serverError, setServerError] = useState<string>();

	const userQuery = useQuery(trpc.user.get.queryOptions({ userId: userId || '' }, { enabled: !!userId && open }));
	const user = userQuery.data;

	const modifyUserMutation = useMutation(
		trpc.user.modify.mutationOptions({
			onSuccess: async () => {
				await refetch();
				await queryClient.invalidateQueries({
					queryKey: trpc.project.getAllUsersWithRoles.queryKey(),
				});
				onOpenChange(false);
			},
			onError: (err) => setServerError(err.message || 'An error occurred while updating the profile.'),
		}),
	);

	const form = useForm({
		defaultValues: {
			name: '',
			previousPassword: '',
			newPassword: '',
		},
		onSubmit: async ({ value }) => {
			setServerError(undefined);
			await modifyUserMutation.mutateAsync({
				userId: userId || '',
				name: value.name,
				previousPassword: value.previousPassword || undefined,
				newPassword: value.newPassword || undefined,
			});
		},
	});

	useEffect(() => {
		if (user) {
			form.setFieldValue('name', user.name || '');
			form.setFieldValue('previousPassword', '');
			form.setFieldValue('newPassword', '');
		}
	}, [user, form]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit Profile</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className='flex flex-col gap-4'
				>
					<TextField form={form} name='name' label='Name' placeholder='Your name' required />

					{isAdmin && (
						<>
							<PasswordField
								form={form}
								name='previousPassword'
								label='Previous Password'
								placeholder='Your previous password'
							/>
							<PasswordField
								form={form}
								name='newPassword'
								label='New Password'
								placeholder='Your new password'
							/>
						</>
					)}

					<FormError error={serverError} />

					<div className='flex justify-end'>
						<form.Subscribe selector={(state: { canSubmit: boolean }) => state.canSubmit}>
							{(canSubmit: boolean) => (
								<Button type='submit' disabled={!canSubmit || modifyUserMutation.isPending}>
									Validate changes
								</Button>
							)}
						</form.Subscribe>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
