import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { signUp } from '@/lib/auth-client';
import { AuthForm, FormTextField } from '@/components/auth-form';

export const Route = createFileRoute('/signup')({
	validateSearch: (search: Record<string, unknown>) => ({
		error: typeof search.error === 'string' ? search.error : undefined,
	}),
	component: SignUp,
});

function SignUp() {
	const navigate = useNavigate();
	const { error: oauthError } = Route.useSearch();
	const [serverError, setServerError] = useState<string | undefined>(oauthError);

	const form = useForm({
		defaultValues: { name: '', email: '', password: '', requiresPasswordReset: false, messagingProviderCode: '' },
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
