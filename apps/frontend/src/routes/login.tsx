import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { sendVerificationEmail, signIn } from '@/lib/auth-client';
import { AuthForm, FormTextField } from '@/components/auth-form';
import { EmailVerificationPending } from '@/components/email-verification-pending';
import { useIsCloud } from '@/hooks/use-nao-mode';
import { buildEmailVerificationCallbackUrl, isEmailNotVerifiedError } from '@/lib/email-verification';
import { rememberSignInMethod } from '@/lib/last-sign-in-method';
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

export function Login() {
	const navigate = useNavigate();
	const router = useRouter();
	const { error: oauthError, redirect } = Route.useSearch();
	const [serverError, setServerError] = useState<string | undefined>(oauthError);
	const [pendingEmail, setPendingEmail] = useState<string>();
	const isSmtpSetup = useQuery(trpc.authConfig.smtp.isSetup.queryOptions());
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const isCloud = useIsCloud();
	const isUserLoginEnabled = config.data?.enableUserLogin;
	const isUserSignupEnabled = config.data?.enableUserSignup;

	const oauthAuthorizeUrl = buildOAuthAuthorizeUrl();
	const safeRedirect = getSafeRedirectPath(redirect);
	const verificationCallbackURL = buildEmailVerificationCallbackUrl(oauthAuthorizeUrl ?? safeRedirect);

	const form = useForm({
		defaultValues: { email: '', password: '' },
		onSubmit: async ({ value }) => {
			if (isUserLoginEnabled === false) {
				return;
			}
			setServerError(undefined);
			const { error } = await signIn.email(value);
			if (error) {
				if (isEmailNotVerifiedError(error)) {
					try {
						const { error: verificationError } = await sendVerificationEmail({
							email: value.email,
							callbackURL: verificationCallbackURL,
						});
						if (verificationError) {
							setServerError(
								verificationError.status === 429
									? 'Too many requests. Wait a minute before trying again.'
									: 'We could not send a verification email. Please try again.',
							);
							return;
						}
					} catch {
						setServerError('We could not send a verification email. Please try again.');
						return;
					}
					setPendingEmail(value.email);
					return;
				}
				setServerError(error.message);
				return;
			}

			rememberSignInMethod('email');
			if (oauthAuthorizeUrl) {
				window.location.href = oauthAuthorizeUrl;
			} else if (safeRedirect) {
				router.history.push(safeRedirect);
			} else {
				navigate({ to: '/' });
			}
		},
	});

	return (
		<AuthForm
			form={form}
			title={pendingEmail ? 'Check your inbox' : 'Log in'}
			submitText='Log in'
			serverError={serverError}
			displaySocialProviders={!pendingEmail}
			socialCallbackUrl={oauthAuthorizeUrl ?? safeRedirect ?? undefined}
			displayEmailPasswordForm={isUserLoginEnabled}
			emailPasswordDisabledMessage='Email and password login is disabled. Use a configured sign-in provider to continue.'
			content={
				pendingEmail ? (
					<EmailVerificationPending
						email={pendingEmail}
						callbackURL={verificationCallbackURL}
						onChangeEmail={() => setPendingEmail(undefined)}
					/>
				) : undefined
			}
			footer={
				!pendingEmail && isCloud && isUserSignupEnabled ? (
					<>
						Don&apos;t have an account?{' '}
						<Link
							to='/signup'
							search={{ error: undefined, redirect: safeRedirect ?? undefined }}
							className='text-violet underline underline-offset-2'
						>
							Create an account
						</Link>
					</>
				) : undefined
			}
		>
			<FormTextField
				form={form}
				name='email'
				type='email'
				title='Email'
				placeholder='joe@gmail.com'
				className='mb-4'
			/>
			<FormTextField
				form={form}
				name='password'
				type='password'
				title='Password'
				className={isUserLoginEnabled && isSmtpSetup.data ? 'mb-2' : 'mb-8'}
			/>
			{isUserLoginEnabled && isSmtpSetup.data && (
				<div className='text-right mb-6'>
					<Link
						to='/forgot-password'
						className='text-xs text-foreground font-medium underline underline-offset-2'
					>
						Forgot password
					</Link>
				</div>
			)}
		</AuthForm>
	);
}
