import { createFileRoute } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, TerminalSquare, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorMessage } from '@/components/ui/error-message';
import NaoLogo from '@/components/icons/nao-full-logo.svg';

export const Route = createFileRoute('/cli-login')({
	validateSearch: (search: Record<string, unknown>) => ({
		port: typeof search.port === 'string' || typeof search.port === 'number' ? String(search.port) : undefined,
		state: typeof search.state === 'string' ? search.state : undefined,
	}),
	component: CliLogin,
});

function parseCallbackPort(port: string | undefined): number | null {
	if (!port || !/^\d+$/.test(port)) {
		return null;
	}
	const parsed = Number(port);
	if (parsed < 1 || parsed > 65535) {
		return null;
	}
	return parsed;
}

function buildCallbackUrl(port: number, params: Record<string, string>): string {
	return `http://127.0.0.1:${port}/callback?${new URLSearchParams(params)}`;
}

function CliLogin() {
	const { port, state } = Route.useSearch();
	const callbackPort = parseCallbackPort(port);

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
			});
			if (!response.ok) {
				throw new Error('Could not authorize the CLI. Please try again.');
			}
			const { code } = (await response.json()) as { code: string };
			window.location.href = buildCallbackUrl(callbackPort, { code, state });
		},
	});

	if (!callbackPort || !state) {
		return (
			<CenteredCard>
				<ErrorMessage message='Invalid CLI login request: missing or invalid port or state parameter.' />
			</CenteredCard>
		);
	}

	if (decision.isSuccess) {
		const accepted = decision.variables;
		return (
			<CenteredCard>
				<div className='flex flex-col items-center gap-4 text-center'>
					{accepted ? (
						<CheckCircle2 className='size-10 text-violet' />
					) : (
						<XCircle className='size-10 text-muted-foreground' />
					)}
					<div className='space-y-2'>
						<h2 className='text-lg font-semibold'>{accepted ? 'CLI authorized' : 'Access denied'}</h2>
						<p className='text-sm text-muted-foreground'>
							{accepted
								? 'You can close this window and return to your terminal.'
								: 'You have denied the nao CLI access to your account. You can close this window.'}
						</p>
					</div>
				</div>
			</CenteredCard>
		);
	}

	return (
		<CenteredCard>
			<Card className='bg-background'>
				<CardHeader>
					<CardTitle className='flex items-center gap-2'>
						<TerminalSquare className='size-5' />
						Authorize nao CLI
					</CardTitle>
					<CardDescription>
						The nao CLI on this computer is requesting access to your nao account.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<p className='text-xs text-muted-foreground'>
						Only continue if you started this login from your own terminal, for example by running{' '}
						<code className='font-mono'>nao login</code> or <code className='font-mono'>nao test</code>.
					</p>
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

function CenteredCard({ children }: { children: React.ReactNode }) {
	return (
		<div className='mx-auto w-full max-w-md p-8 my-auto'>
			<div className='flex flex-col items-center gap-8 mb-10 pb-2'>
				<NaoLogo className='w-20 h-auto text-foreground' />
				<h1 className='font-borna text-2xl font-medium text-center'>Connect the CLI</h1>
			</div>
			{children}
		</div>
	);
}
