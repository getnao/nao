import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { signUp } from '@/lib/auth-client';
import { AuthForm, FormTextField } from '@/components/auth-form';

export const Route = createFileRoute('/signup')({
	component: SignUp,
});

function SignUp() {
	const navigate = useNavigate();
	const [serverError, setServerError] = useState<string>();

	const form = useForm({
		defaultValues: { name: '', email: '', password: '', requiresPasswordReset: false },
		onSubmit: async ({ value }) => {
			setServerError(undefined);
			await signUp.email(value, {
				onSuccess: () => navigate({ to: '/' }),
				onError: (err) => setServerError(err.error.message),
			});
		},
	});

	return (
		<AuthForm form={form} title='Sign Up' submitText='Sign Up' serverError={serverError}>
			<FormTextField form={form} name='name' placeholder='Name' />
			<FormTextField form={form} name='email' type='email' placeholder='Email' />
			<FormTextField form={form} name='password' type='password' placeholder='Password' />
		</AuthForm>
	);
}
