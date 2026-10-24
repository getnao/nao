import { Loader2 } from 'lucide-react';

import { ScreenLayout } from '@/components/screen-layout';
import { displayHost, type Server } from '@/lib/servers';

export function Connecting({ server }: { server: Server | undefined }) {
	return (
		<ScreenLayout
			title={server ? `Connecting to ${server.name}` : 'Connecting'}
			description={server ? displayHost(server.url) : undefined}
		>
			<div className='flex justify-center'>
				<Loader2 className='size-6 animate-spin text-violet' />
			</div>
		</ScreenLayout>
	);
}
