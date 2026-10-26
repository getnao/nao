import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { useState } from 'react';

import { Button, ExternalLinkButton } from '@/components/button';
import { Message } from '@/components/message';
import { Panel, ScreenLayout } from '@/components/screen-layout';
import { useAction } from '@/hooks/use-action';
import { copyText } from '@/lib/clipboard';
import { cancelSignIn } from '@/lib/commands';
import type { Server } from '@/lib/servers';

export function SigningIn({ server, signInUrl }: { server: Server | undefined; signInUrl: string }) {
	const [isCopied, setIsCopied] = useState(false);
	const cancel = useAction(cancelSignIn);

	const copyLink = async () => {
		setIsCopied(await copyText(signInUrl));
	};

	return (
		<ScreenLayout
			title='Signing in…'
			description={`Continue in your browser to sign in to ${server?.name ?? 'your nao server'}. This window updates once you approve.`}
		>
			<Panel>
				<div className='flex items-center gap-3 text-sm'>
					<Loader2 className='size-4 shrink-0 animate-spin text-violet' />
					Waiting for your browser…
				</div>
				<p className='text-xs text-muted-foreground'>
					Browser didn&apos;t open? Copy the sign-in link and paste it into your browser.
				</p>
				<input
					readOnly
					value={signInUrl}
					aria-label='Sign-in link'
					data-testid='sign-in-link'
					onFocus={(event) => event.target.select()}
					className='h-9 w-full truncate rounded-md border border-input bg-transparent px-3 font-mono text-xs text-muted-foreground'
				/>
				<div className='flex flex-wrap justify-end gap-2'>
					<Button variant='outline' onClick={copyLink}>
						{isCopied ? <Check /> : <Copy />}
						{isCopied ? 'Copied' : 'Copy sign-in link'}
					</Button>
					<ExternalLinkButton href={signInUrl}>
						<ExternalLink />
						Open browser
					</ExternalLinkButton>
				</div>
				{cancel.error && <Message tone='error'>{cancel.error}</Message>}
			</Panel>
			<Button variant='ghost' onClick={() => cancel.run()} isLoading={cancel.isPending}>
				Cancel
			</Button>
		</ScreenLayout>
	);
}
