import { createFileRoute } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { AppWindow, CheckCircle2, TerminalSquare, XCircle } from 'lucide-react';

import type { LoginClient } from '@/lib/cli-login';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorMessage } from '@/components/ui/error-message';
import NaoLogo from '@/components/icons/nao-full-logo.svg';
import { buildCallbackUrl, getLoginClientCopy, parseCallbackPort, parseLoginClient } from '@/lib/cli-login';

export const Route = createFileRoute('/cli-login')({
	validateSearch: (search: Record<string, unknown>) => ({
		port: typeof search.port === 'string' || typeof search.port === 'number' ? String(search.port) : undefined,
		state: typeof search.state === 'string' ? search.state : undefined,
		client: search.client === 'desktop' ? ('desktop' as const) : undefined,
	}),
	component: CliLogin,
});

function CliLogin() {
	const { port, state, client: clientParam } = Route.useSearch();
	const callbackPort = parseCallbackPort(port);
	const client = parseLoginClient(clientParam);
	const copy = getLoginClientCopy(client);

	const decision = useMutation({
		mutationFn: async (accept: boolean) => {
			if (!callbackPort || !state) {
				throw new Error('Invalid request.');
			}
			if (!accept) {
				window.location.href = buildCallbackUrl(callbackPort, { error: 'access_denied', state });
				return;
			}
			const response = await fetch('/api/cli-auth/authorize', {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ client }),
			});
			if (!response.ok) {
				throw new Error(copy.authorizeError);
			}
			const { code } = (await response.json()) as { code: string };
			window.location.href = buildCallbackUrl(callbackPort, { code, state });
		},
	});

	if (!callbackPort || !state) {
		return (
			<CenteredCard heading={copy.heading}>
				<ErrorMessage message={copy.invalidRequest} />
			</CenteredCard>
		);
	}

	if (decision.isSuccess) {
		const accepted = decision.variables;
		return (
			<CenteredCard heading={copy.heading}>
				<div className='flex flex-col items-center gap-4 text-center'>
					{accepted ? (
						<CheckCircle2 className='size-10 text-violet' />
					) : (
						<XCircle className='size-10 text-muted-foreground' />
					)}
					<div className='space-y-2'>
						<h2 className='text-lg font-semibold'>{accepted ? copy.authorizedTitle : 'Access denied'}</h2>
						<p className='text-sm text-muted-foreground'>
							{accepted ? copy.authorizedMessage : copy.deniedMessage}
						</p>
					</div>
				</div>
			</CenteredCard>
		);
	}

	return (
		<CenteredCard heading={copy.heading}>
			<Card className='bg-background'>
				<CardHeader>
					<CardTitle className='flex items-center gap-2'>
						<ClientIcon client={client} />
						{copy.title}
					</CardTitle>
					<CardDescription>{copy.description}</CardDescription>
				</CardHeader>
				<CardContent>
					<ClientHint client={client} />
					{decision.isError && (
						<div className='mt-3'>
							<ErrorMessage message={decision.error.message} />
						</div>
					)}
				</CardContent>
				<CardFooter className='flex justify-end gap-2'>
					<Button variant='outline' onClick={() => decision.mutate(false)} disabled={decision.isPending}>
						Deny
					</Button>
					<Button
						variant='primary-gradient'
						onClick={() => decision.mutate(true)}
						isLoading={decision.isPending}
					>
						Authorize
					</Button>
				</CardFooter>
			</Card>
		</CenteredCard>
	);
}

function ClientIcon({ client }: { client: LoginClient }) {
	if (client === 'desktop') {
		return <AppWindow className='size-5' />;
	}
	return <TerminalSquare className='size-5' />;
}

function ClientHint({ client }: { client: LoginClient }) {
	if (client === 'desktop') {
		return (
			<p className='text-xs text-muted-foreground'>
				Only continue if you just clicked Sign in in the nao desktop app on this computer.
			</p>
		);
	}
	return (
		<p className='text-xs text-muted-foreground'>
			Only continue if you started this login from your own terminal, for example by running{' '}
			<code className='font-mono'>nao login</code> or <code className='font-mono'>nao test</code>.
		</p>
	);
}

function CenteredCard({ heading, children }: { heading: string; children: React.ReactNode }) {
	return (
		<div className='mx-auto w-full max-w-md p-8 my-auto'>
			<div className='flex flex-col items-center gap-8 mb-10 pb-2'>
				<NaoLogo className='w-20 h-auto text-foreground' />
				<h1 className='font-borna text-2xl font-medium text-center'>{heading}</h1>
			</div>
			{children}
		</div>
	);
}
