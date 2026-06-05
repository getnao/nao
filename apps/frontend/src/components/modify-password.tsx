import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';
import { AuthForm, FormTextField } from '@/components/auth-form';

export function ModifyPassword() {
	const { refetch } = useSession();
	const [serverError, setServerError] = useState<string | undefined>();

	const modifyUserPassword = useMutation(
		trpc.account.modifyPassword.mutationOptions({
			onSuccess: async () => {
				await refetch();
			},
			onError: (err) => setServerError(err.message),
		}),
	);

	const form = useForm({
		defaultValues: { newPassword: '', confirmPassword: '' },
		onSubmit: async ({ value }) => {
			if (value.newPassword !== value.confirmPassword) {
				setServerError('Passwords do not match');
				return;
			}
			setServerError(undefined);
			await modifyUserPassword.mutateAsync({
				newPassword: value.newPassword,
				confirmPassword: value.confirmPassword,
			});
		},
	});

	return (
		<div className='flex h-screen'>
			<AuthForm
				form={form}
				title='Change your password to secure your account'
				submitText={modifyUserPassword.isPending ? 'Updating...' : 'Reset password'}
				serverError={serverError}
			>
				<FormTextField form={form} name='newPassword' type='password' title='New password' className='mb-6' />
				<FormTextField
					form={form}
					name='confirmPassword'
					type='password'
					title='Confirm new password'
					className='mb-10'
				/>
			</AuthForm>
		</div>
	);
}
