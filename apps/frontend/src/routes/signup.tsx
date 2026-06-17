import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { signUp } from '@/lib/auth-client';
import { AuthForm, FormTextField } from '@/components/auth-form';
import { getSafeRedirectPath } from '@/lib/safe-redirect';
import { trpc } from '@/main';

export const Route = createFileRoute('/signup')({
	validateSearch: (search: Record<string, unknown>) => ({
		error: typeof search.error === 'string' ? search.error : undefined,
		redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
	}),
	component: SignUp,
});

function SignUp() {
	const navigate = useNavigate();
	const router = useRouter();
	const { error: oauthError, redirect } = Route.useSearch();
	const [serverError, setServerError] = useState<string | undefined>(oauthError);
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const isUserSignupEnabled = config.data?.enableUserSignup === true;
	const safeRedirect = getSafeRedirectPath(redirect);

	const form = useForm({
		defaultValues: { name: '', email: '', password: '', requiresPasswordReset: false, messagingProviderCode: '' },
		onSubmit: async ({ value }) => {
			setServerError(undefined);
			await signUp.email(value, {
				onSuccess: () => {
					if (safeRedirect) {
						router.history.push(safeRedirect);
					} else {
						navigate({ to: '/' });
					}
				},
				onError: (err) => setServerError(err.error.message),
			});
		},
	});

	useEffect(() => {
		if (config.data && !isUserSignupEnabled) {
			navigate({
				to: '/login',
				search: { error: 'Sign up is disabled.', redirect: safeRedirect ?? undefined },
				replace: true,
			});
		}
	}, [config.data, isUserSignupEnabled, navigate, safeRedirect]);

	if (config.isLoading) {
		return null;
	}

	if (config.data && !isUserSignupEnabled) {
		return null;
	}

	return (
		<AuthForm
			form={form}
			title='Sign up'
			submitText='Sign up'
			serverError={serverError}
			displaySocialProviders={true}
			socialCallbackUrl={safeRedirect ?? undefined}
			footer={
				<>
					Already have an account?{' '}
					<Link
						to='/login'
						search={{ error: undefined, redirect: safeRedirect ?? undefined }}
						className='text-violet underline underline-offset-2'
					>
						Log in
					</Link>
				</>
			}
		>
			<FormTextField form={form} name='name' title='Name' placeholder='Joe' className='mb-6' />
			<FormTextField
				form={form}
				name='email'
				type='email'
				title='Email'
				placeholder='joe@gmail.com'
				className='mb-6'
			/>
			<FormTextField form={form} name='password' type='password' title='Password' className='mb-10' />
		</AuthForm>
	);
}
