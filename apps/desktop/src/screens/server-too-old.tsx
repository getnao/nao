import { RotateCw } from 'lucide-react';

import { Button } from '@/components/button';
import { Message } from '@/components/message';
import { Panel, ScreenLayout } from '@/components/screen-layout';
import { useAction } from '@/hooks/use-action';
import { selectServer } from '@/lib/commands';
import { navigateTo } from '@/lib/routes';
import { describeTooOldServer, type Server } from '@/lib/servers';

export function ServerTooOld({
	serverId,
	server,
	version,
	minimum,
}: {
	serverId: string;
	server: Server | undefined;
	version?: string;
	minimum: string;
}) {
	const retry = useAction(selectServer);

	return (
		<ScreenLayout title={`${server?.name ?? 'This server'} needs an update`}>
			<Panel>
				<p className='text-sm'>{describeTooOldServer(version, minimum)}</p>
				{retry.error && <Message tone='error'>{retry.error}</Message>}
				<div className='flex justify-end gap-2'>
					<Button variant='outline' onClick={() => navigateTo({ name: 'servers' })}>
						Switch server
					</Button>
					<Button onClick={() => retry.run(serverId)} isLoading={retry.isPending}>
						<RotateCw />
						Check again
					</Button>
				</div>
			</Panel>
		</ScreenLayout>
	);
}
