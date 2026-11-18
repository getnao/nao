import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ChallengeMethod } from '@/components/two-factor-challenge';
import { handleSsoSignIn, sendVerificationEmail, signIn, twoFactor } from '@/lib/auth-client';
import { AuthForm, FormTextField } from '@/components/auth-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmailVerificationPending } from '@/components/email-verification-pending';
import { TwoFactorChallenge } from '@/components/two-factor-challenge';
import { useIsCloud } from '@/hooks/use-nao-mode';
import {
	buildEmailVerificationCallbackUrl,
	getSignInErrorMessage,
	isEmailNotVerifiedError,
} from '@/lib/email-verification';
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
	const [serverError, setServerError] = useState<string | undefined>(getSignInErrorMessage(oauthError));
	const [pendingEmail, setPendingEmail] = useState<string>();
	const [challengeMethod, setChallengeMethod] = useState<ChallengeMethod>();
	const [isSsoMode, setIsSsoMode] = useState(false);
	const isSmtpSetup = useQuery(trpc.authConfig.smtp.isSetup.queryOptions());
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const isCloud = useIsCloud();
	const isUserLoginEnabled = config.data?.enableUserLogin;
	const isUserSignupEnabled = config.data?.enableUserSignup;

	const oauthAuthorizeUrl = buildOAuthAuthorizeUrl();
	const safeRedirect = getSafeRedirectPath(redirect);
	const verificationCallbackURL = buildEmailVerificationCallbackUrl(oauthAuthorizeUrl ?? safeRedirect);

	const redirectAfterSignIn = () => {
		rememberSignInMethod('email');
		if (oauthAuthorizeUrl) {
			window.location.href = oauthAuthorizeUrl;
		} else if (safeRedirect) {
			router.history.push(safeRedirect);
		} else {
			navigate({ to: '/' });
		}
	};

	const form = useForm({
		defaultValues: { email: '', password: '' },
		onSubmit: async ({ value }) => {
			if (isUserLoginEnabled === false) {
				return;
			}
			setServerError(undefined);
			const { data, error } = await signIn.email(value);
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

			if (data && 'twoFactorRedirect' in data) {
				const method = readChallengeMethod(data);
				if (method === 'email') {
					await twoFactor.sendOtp();
				}
				setChallengeMethod(method);
				return;
			}

			redirectAfterSignIn();
		},
	});
	const isFirstStep = !pendingEmail && !challengeMethod;

	return (
		<AuthForm
			form={form}
			title={
				pendingEmail
					? 'Check your inbox'
					: challengeMethod
						? 'Two-factor authentication'
						: isSsoMode
							? 'Log in with SSO'
							: 'Log in'
			}
			submitText='Log in'
			serverError={serverError}
			displaySocialProviders={isFirstStep && !isSsoMode}
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
				) : challengeMethod ? (
					<TwoFactorChallenge
						method={challengeMethod}
						onVerified={redirectAfterSignIn}
						onCancel={() => {
							setChallengeMethod(undefined);
						}}
					/>
				) : isSsoMode ? (
					<SsoSignInForm callbackURL={oauthAuthorizeUrl ?? safeRedirect ?? '/'} onError={setServerError} />
				) : undefined
			}
			footer={
				isFirstStep && isCloud ? (
					<>
						<button
							type='button'
							onClick={() => {
								setServerError(undefined);
								setIsSsoMode(!isSsoMode);
							}}
							className='mb-3 block w-full underline underline-offset-2'
						>
							{isSsoMode ? 'Use another sign-in method' : 'Log in with SSO'}
						</button>
						{isUserSignupEnabled && <SignupLink redirect={safeRedirect} />}
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

/** The sign-in answer lists `totp` only for accounts set up with an authenticator app. */
function readChallengeMethod(challenge: object): ChallengeMethod {
	const methods = (challenge as { twoFactorMethods?: string[] }).twoFactorMethods;
	return methods?.includes('totp') ? 'totp' : 'email';
}

function SignupLink({ redirect }: { redirect: string | null }) {
	return (
		<>
			Don&apos;t have an account?{' '}
			<Link
				to='/signup'
				search={{ error: undefined, redirect: redirect ?? undefined }}
				className='text-violet underline underline-offset-2'
			>
				Create an account
			</Link>
		</>
	);
}

function SsoSignInForm({ callbackURL, onError }: { callbackURL: string; onError: (error?: string) => void }) {
	const [email, setEmail] = useState('');
	const [isPending, setIsPending] = useState(false);

	return (
		<form
			className='flex flex-col gap-3'
			onSubmit={async (event) => {
				event.preventDefault();
				setIsPending(true);
				onError(undefined);
				const error = await handleSsoSignIn(email.trim(), callbackURL);
				if (error) {
					onError(error);
					setIsPending(false);
				}
			}}
		>
			<Input
				type='email'
				required
				autoFocus
				placeholder='you@company.com'
				value={email}
				onChange={(event) => setEmail(event.target.value)}
			/>
			<Button type='submit' variant='primary-gradient' className='h-11 w-full rounded-full' isLoading={isPending}>
				Continue with SSO
			</Button>
		</form>
	);
}
