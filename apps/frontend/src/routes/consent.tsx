import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorMessage } from '@/components/ui/error-message';
import { Spinner } from '@/components/ui/spinner';
import NaoLogo from '@/components/icons/nao-full-logo.svg';
import { authClient } from '@/lib/auth-client';

interface PublicClient {
	client_id: string;
	client_name?: string;
	client_uri?: string;
	logo_uri?: string;
	tos_uri?: string;
	policy_uri?: string;
}

export const Route = createFileRoute('/consent')({
	validateSearch: (search: Record<string, unknown>) => ({
		client_id: typeof search.client_id === 'string' ? search.client_id : undefined,
		scope: typeof search.scope === 'string' ? search.scope : undefined,
		code: typeof search.code === 'string' ? search.code : undefined,
	}),
	component: Consent,
});

function Consent() {
	const { client_id, scope } = Route.useSearch();

	const clientQuery = useQuery({
		queryKey: ['oauth-public-client', client_id],
		enabled: Boolean(client_id),
		queryFn: async (): Promise<PublicClient> => {
			const response = await fetch(
				`/api/auth/oauth2/public-client?client_id=${encodeURIComponent(client_id ?? '')}`,
				{ credentials: 'include' },
			);
			if (!response.ok) {
				throw new Error('Could not load application details.');
			}
			return response.json();
		},
	});

	const decision = useMutation({
		mutationFn: async (accept: boolean) => {
			const result = await authClient.oauth2.consent({ accept });
			const url = result?.data?.url;
			if (url) {
				window.location.href = url;
			}
		},
	});

	if (!client_id) {
		return (
			<CenteredCard>
				<ErrorMessage message='Missing client_id parameter.' />
			</CenteredCard>
		);
	}

	if (clientQuery.isPending) {
		return (
			<CenteredCard>
				<div className='flex justify-center py-8'>
					<Spinner className='size-6' />
				</div>
			</CenteredCard>
		);
	}

	if (clientQuery.isError) {
		return (
			<CenteredCard>
				<ErrorMessage message={clientQuery.error.message} />
			</CenteredCard>
		);
	}

	const client = clientQuery.data;
	const clientLabel = client.client_name ?? client.client_id;
	const requestedScopes = (scope ?? '').split(/\s+/).filter(Boolean);

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
						<h2 className='text-lg font-semibold'>{accepted ? 'Access granted' : 'Access denied'}</h2>
						<p className='text-sm text-muted-foreground'>
							{accepted
								? `You have authorized ${clientLabel} to access your nao account. You can close this window.`
								: `You have denied ${clientLabel} access to your nao account. You can close this window.`}
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
					<CardTitle>Authorize {clientLabel}</CardTitle>
					<CardDescription>{clientLabel} is requesting access to your nao account.</CardDescription>
				</CardHeader>
				<CardContent className='space-y-3'>
					{requestedScopes.length > 0 && (
						<div>
							<p className='text-sm font-medium mb-2'>The application is requesting:</p>
							<ul className='list-disc list-inside text-sm text-muted-foreground'>
								{requestedScopes.map((scopeName) => (
									<li key={scopeName}>{scopeName}</li>
								))}
							</ul>
						</div>
					)}
					{client.client_uri && (
						<p className='text-xs text-muted-foreground'>
							Application website:{' '}
							<a href={client.client_uri} target='_blank' rel='noreferrer' className='underline'>
								{client.client_uri}
							</a>
						</p>
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
						Allow
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
				<h1 className='font-borna text-2xl font-medium text-center'>Authorize</h1>
			</div>
			{children}
		</div>
	);
}
