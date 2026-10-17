import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Link2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorMessage } from '@/components/ui/error-message';
import { Spinner } from '@/components/ui/spinner';
import NaoLogo from '@/components/icons/nao-full-logo.svg';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

export const Route = createFileRoute('/discord-link')({
	validateSearch: (search: Record<string, unknown>) => ({
		token: typeof search.token === 'string' ? search.token : undefined,
	}),
	component: DiscordLink,
});

function DiscordLink() {
	const { token } = Route.useSearch();

	if (!token) {
		return (
			<CenteredCard>
				<ErrorMessage message='Invalid link: the token is missing. Mention the bot again to get a new one.' />
			</CenteredCard>
		);
	}

	return <DiscordLinkConfirmation token={token} />;
}

function DiscordLinkConfirmation({ token }: { token: string }) {
	const { data: session } = useSession();
	const linkRequest = useQuery({ ...trpc.user.getDiscordLinkRequest.queryOptions({ token }), retry: false });
	const linkAccount = useMutation(trpc.user.linkDiscordAccount.mutationOptions());

	if (linkRequest.isPending) {
		return (
			<CenteredCard>
				<div className='flex justify-center'>
					<Spinner className='size-6' />
				</div>
			</CenteredCard>
		);
	}

	if (linkRequest.isError) {
		return (
			<CenteredCard>
				<ErrorMessage message={linkRequest.error.message} />
			</CenteredCard>
		);
	}

	if (linkAccount.isSuccess) {
		return (
			<CenteredCard>
				<div className='flex flex-col items-center gap-4 text-center'>
					<CheckCircle2 className='size-10 text-violet' />
					<div className='space-y-2'>
						<h2 className='text-lg font-semibold'>Discord account connected</h2>
						<p className='text-sm text-muted-foreground'>
							You can close this window and ask your question again in Discord.
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
						<Link2 className='size-5' />
						Connect your Discord account
					</CardTitle>
					<CardDescription>
						Messages from{' '}
						<span className='font-medium text-foreground'>@{linkRequest.data.discordUserName}</span> on
						Discord will be answered as{' '}
						<span className='font-medium text-foreground'>{session?.user.email}</span>.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<p className='text-xs text-muted-foreground'>
						Only continue if this is your Discord account and you opened this link from a direct message the
						bot sent you.
					</p>
					{linkAccount.isError && (
						<div className='mt-3'>
							<ErrorMessage message={linkAccount.error.message} />
						</div>
					)}
				</CardContent>
				<CardFooter className='flex justify-end'>
					<Button
						variant='primary-gradient'
						onClick={() => linkAccount.mutate({ token })}
						isLoading={linkAccount.isPending}
					>
						Connect
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
				<h1 className='font-borna text-2xl font-medium text-center'>Connect Discord</h1>
			</div>
			{children}
		</div>
	);
}
