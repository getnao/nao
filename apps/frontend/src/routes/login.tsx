import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { signIn } from '@/lib/auth-client';
import { AuthForm, FormTextField } from '@/components/auth-form';
import { getSafeRedirectPath } from '@/lib/safe-redirect';
import { trpc } from '@/main';

export const Route = createFileRoute('/login')({
	validateSearch: (search: Record<string, unknown>) => ({
		error: typeof search.error === 'string' ? search.error : undefined,
		redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
	}),
	component: Login,
});

function buildOAuthAuthorizeUrl() {
	const params = new URLSearchParams(window.location.search);
	if (!params.has('client_id')) {
		return null;
	}
	return `/api/auth/oauth2/authorize${window.location.search}`;
}

function Login() {
	const navigate = useNavigate();
	const router = useRouter();
	const { error: oauthError, redirect } = Route.useSearch();
	const [serverError, setServerError] = useState<string | undefined>(oauthError);
	const isSmtpSetup = useQuery(trpc.authConfig.smtp.isSetup.queryOptions());
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const isCloud = config.data?.naoMode === 'cloud';
	const isUserLoginEnabled = config.data?.enableUserLogin;
	const isUserSignupEnabled = config.data?.enableUserSignup;

	const oauthAuthorizeUrl = buildOAuthAuthorizeUrl();
	const safeRedirect = getSafeRedirectPath(redirect);

	const form = useForm({
		defaultValues: { email: '', password: '' },
		onSubmit: async ({ value }) => {
			if (isUserLoginEnabled === false) {
				return;
			}
			setServerError(undefined);
			await signIn.email(value, {
				onSuccess: () => {
					if (oauthAuthorizeUrl) {
						window.location.href = oauthAuthorizeUrl;
					} else if (safeRedirect) {
						router.history.push(safeRedirect);
					} else {
						navigate({ to: '/' });
					}
				},
				onError: (err) => setServerError(err.error.message),
			});
		},
	});

	return (
		<AuthForm
			form={form}
			title='Log In'
			submitText='Log In'
			serverError={serverError}
			displaySocialProviders={true}
			socialCallbackUrl={oauthAuthorizeUrl ?? safeRedirect ?? undefined}
			displayEmailPasswordForm={isUserLoginEnabled}
			emailPasswordDisabledMessage='Email and password login is disabled. Use a configured sign-in provider to continue.'
			footer={
				isCloud && isUserSignupEnabled ? (
					<>
						Don&apos;t have an account?{' '}
						<Link
							to='/signup'
							search={{ error: undefined, redirect: safeRedirect ?? undefined }}
							className='text-foreground underline underline-offset-4'
						>
							Sign up
						</Link>
					</>
				) : undefined
			}
		>
			<FormTextField form={form} name='email' type='email' placeholder='Email' />
			<FormTextField form={form} name='password' type='password' placeholder='Password' />
			{isUserLoginEnabled && isSmtpSetup.data && (
				<div className='text-right'>
					<Link to='/forgot-password' className='text-sm underline underline-offset-4'>
						Forgot password?
					</Link>
				</div>
			)}
		</AuthForm>
	);
}
