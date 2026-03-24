import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { resetPassword } from '@/lib/auth-client';
import { AuthForm, FormTextField } from '@/components/auth-form';
import { useRedirectIfSmtpNotSetup } from '@/hooks/useRedirectIfSmtpNotSetup';

export const Route = createFileRoute('/reset-password')({
	validateSearch: (search: Record<string, unknown>) => ({
		token: typeof search.token === 'string' ? search.token : undefined,
		error: typeof search.error === 'string' ? search.error : undefined,
	}),
	component: ResetPassword,
});

function ResetPassword() {
	const isPending = useRedirectIfSmtpNotSetup();
	const navigate = useNavigate();
	const { token, error: tokenError } = Route.useSearch();
	const [serverError, setServerError] = useState<string | undefined>();

	const form = useForm({
		defaultValues: { newPassword: '', confirmPassword: '' },
		onSubmit: async ({ value }) => {
			if (value.newPassword !== value.confirmPassword) {
				setServerError('Passwords do not match.');
				return;
			}
			setServerError(undefined);
			const { error } = await resetPassword({ newPassword: value.newPassword, token: token! });
			if (error) {
				setServerError(error.message);
			} else {
				navigate({ to: '/login', search: { error: undefined } });
			}
		},
	});

	if (isPending) {
		return null;
	}

	if (tokenError === 'INVALID_TOKEN' || !token) {
		return (
			<div className='mx-auto w-full max-w-md p-8 my-auto text-center'>
				<h1 className='text-2xl font-semibold mb-4'>Invalid or expired link</h1>
				<p className='text-muted-foreground mb-6'>
					This password reset link is no longer valid. Please request a new one.
				</p>
				<Link to='/forgot-password' className='text-sm underline underline-offset-4'>
					Request a new link
				</Link>
			</div>
		);
	}

	return (
		<AuthForm form={form} title='Reset password' submitText='Set new password' serverError={serverError}>
			<FormTextField form={form} name='newPassword' type='password' placeholder='New password' />
			<FormTextField form={form} name='confirmPassword' type='password' placeholder='Confirm new password' />
		</AuthForm>
	);
}
