import { RotateCw, WifiOff } from 'lucide-react';

import { Button } from '@/components/button';
import { Message } from '@/components/message';
import { Panel, ScreenLayout } from '@/components/screen-layout';
import { useAction } from '@/hooks/use-action';
import { selectServer } from '@/lib/commands';
import { navigateTo, type UnreachableReason } from '@/lib/routes';
import { describeUnreachableReason, displayHost, type Server } from '@/lib/servers';

export function ServerUnreachable({
	serverId,
	server,
	reason,
}: {
	serverId: string;
	server: Server | undefined;
	reason: UnreachableReason;
}) {
	const retry = useAction(selectServer);

	return (
		<ScreenLayout
			title={`Can't reach ${server?.name ?? 'the server'}`}
			description={server ? displayHost(server.url) : undefined}
		>
			<Panel>
				<div className='flex items-start gap-3 text-sm'>
					<WifiOff className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
					<p>{describeUnreachableReason(reason)}</p>
				</div>
				{retry.error && <Message tone='error'>{retry.error}</Message>}
				<div className='flex justify-end gap-2'>
					<Button variant='outline' onClick={() => navigateTo({ name: 'servers' })}>
						Switch server
					</Button>
					<Button onClick={() => retry.run(serverId)} isLoading={retry.isPending}>
						<RotateCw />
						Retry
					</Button>
				</div>
			</Panel>
		</ScreenLayout>
	);
}
