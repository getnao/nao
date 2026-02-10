import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { signIn } from '@/lib/auth-client';
import { AuthForm, FormTextField } from '@/components/auth-form';

export const Route = createFileRoute('/login')({
	component: Login,
});

function Login() {
	const navigate = useNavigate();
	const [serverError, setServerError] = useState<string>();

	const form = useForm({
		defaultValues: { email: '', password: '' },
		onSubmit: async ({ value }) => {
			setServerError(undefined);
			await signIn.email(value, {
				onSuccess: () => navigate({ to: '/' }),
				onError: (err) => setServerError(err.error.message),
			});
		},
	});

	return (
		<AuthForm form={form} title='Log In' submitText='Log In' serverError={serverError}>
			<FormTextField form={form} name='email' type='email' placeholder='Email' />
			<FormTextField form={form} name='password' type='password' placeholder='Password' />
		</AuthForm>
	);
}
