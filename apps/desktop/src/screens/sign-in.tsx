import { LogIn } from 'lucide-react';

import { Button } from '@/components/button';
import { Message } from '@/components/message';
import { Panel, ScreenLayout } from '@/components/screen-layout';
import { useAction } from '@/hooks/use-action';
import { startSignIn } from '@/lib/commands';
import { navigateTo } from '@/lib/routes';
import { describeSignInError, type Server } from '@/lib/servers';

export function SignIn({ serverId, server, error }: { serverId: string; server: Server | undefined; error?: string }) {
	const signIn = useAction(startSignIn);
	const message = signIn.error ?? describeSignInError(error);

	return (
		<ScreenLayout
			title={`Sign in to ${server?.name ?? 'nao'}`}
			description='You sign in through your usual browser, where your password manager and single sign-on already work.'
		>
			<Panel>
				{message && <Message tone='error'>{message}</Message>}
				<Button onClick={() => signIn.run(serverId)} isLoading={signIn.isPending}>
					<LogIn />
					Sign in with browser
				</Button>
			</Panel>
			<Button variant='ghost' onClick={() => navigateTo({ name: 'servers' })}>
				Switch server
			</Button>
		</ScreenLayout>
	);
}
