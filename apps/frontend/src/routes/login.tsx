import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { signIn } from '@/lib/auth-client';
import { AuthForm, FormTextField } from '@/components/auth-form';
import { trpc } from '@/main';

export const Route = createFileRoute('/login')({
	validateSearch: (search: Record<string, unknown>) => ({
		error: typeof search.error === 'string' ? search.error : undefined,
	}),
	component: Login,
});

function buildMcpAuthorizeUrl() {
	const params = new URLSearchParams(window.location.search);
	if (!params.has('client_id')) {
		return null;
	}
	return `/api/auth/mcp/authorize${window.location.search}`;
}

function Login() {
	const navigate = useNavigate();
	const { error: oauthError } = Route.useSearch();
	const [serverError, setServerError] = useState<string | undefined>(oauthError);
	const isSmtpSetup = useQuery(trpc.authConfig.smtp.isSetup.queryOptions());
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const isCloud = config.data?.naoMode === 'cloud';

	const mcpAuthorizeUrl = buildMcpAuthorizeUrl();

	const form = useForm({
		defaultValues: { email: '', password: '' },
		onSubmit: async ({ value }) => {
			setServerError(undefined);
			await signIn.email(value, {
				onSuccess: () => {
					if (mcpAuthorizeUrl) {
						window.location.href = mcpAuthorizeUrl;
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
			socialCallbackUrl={mcpAuthorizeUrl ?? undefined}
			footer={
				isCloud ? (
					<>
						Don&apos;t have an account?{' '}
						<Link
							to='/signup'
							search={{ error: undefined }}
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
			{isSmtpSetup.data && (
				<div className='text-right'>
					<Link to='/forgot-password' className='text-sm underline underline-offset-4'>
						Forgot password?
					</Link>
				</div>
			)}
		</AuthForm>
	);
}
