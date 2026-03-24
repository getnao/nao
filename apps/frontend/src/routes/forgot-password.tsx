import { createFileRoute, Link } from '@tanstack/react-router';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { requestPasswordReset } from '@/lib/auth-client';
import { AuthForm, FormTextField } from '@/components/auth-form';
import { useRedirectIfSmtpNotSetup } from '@/hooks/useRedirectIfSmtpNotSetup';

export const Route = createFileRoute('/forgot-password')({
	component: ForgotPassword,
});

function ForgotPassword() {
	const isPending = useRedirectIfSmtpNotSetup();
	const [submitted, setSubmitted] = useState(false);
	const [serverError, setServerError] = useState<string | undefined>();

	const form = useForm({
		defaultValues: { email: '' },
		onSubmit: async ({ value }) => {
			setServerError(undefined);
			const { error } = await requestPasswordReset({
				email: value.email,
				redirectTo: `${window.location.origin}/reset-password`,
			});
			if (error) {
				setServerError(error.message);
			} else {
				setSubmitted(true);
			}
		},
	});

	if (isPending) {
		return null;
	}

	if (submitted) {
		return (
			<div className='mx-auto w-full max-w-md p-8 my-auto text-center'>
				<h1 className='text-2xl font-semibold mb-4'>Check your inbox</h1>
				<p className='text-muted-foreground mb-6'>
					If an account exists for that email, we sent a password reset link. Check your spam folder if you
					don't see it.
				</p>
				<Link to='/login' search={{ error: undefined }} className='text-sm underline underline-offset-4'>
					Back to login
				</Link>
			</div>
		);
	}

	return (
		<AuthForm form={form} title='Forgot password' submitText='Send reset link' serverError={serverError}>
			<FormTextField form={form} name='email' type='email' placeholder='Email' />
			<div className='text-right'>
				<Link to='/login' search={{ error: undefined }} className='text-sm underline underline-offset-4'>
					Back to login
				</Link>
			</div>
		</AuthForm>
	);
}
