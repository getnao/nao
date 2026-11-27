import { ChevronRight, Cloud, Plus, Server as ServerIcon, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/button';
import { Message } from '@/components/message';
import { ScreenLayout } from '@/components/screen-layout';
import { useAction } from '@/hooks/use-action';
import { removeServer, selectServer } from '@/lib/commands';
import { navigateTo } from '@/lib/routes';
import { displayHost, formatLastUsed, isInsecureServerUrl, type Server, sortServers } from '@/lib/servers';

export function ServerPicker({
	servers,
	loadError,
	onServersChanged,
}: {
	servers: Server[] | undefined;
	loadError?: string;
	onServersChanged: () => Promise<void>;
}) {
	const select = useAction(selectServer);
	const remove = useAction(async (id: string) => {
		await removeServer(id);
		await onServersChanged();
	});
	const error = loadError ?? select.error ?? remove.error;

	return (
		<ScreenLayout title='Choose a server' description='Connect to nao Cloud or to your own nao instance.'>
			<div className='flex flex-col gap-2' data-testid='server-list'>
				{sortServers(servers ?? []).map((server) => (
					<ServerRow
						key={server.id}
						server={server}
						disabled={select.isPending}
						onSelect={() => select.run(server.id)}
						onRemove={() => remove.run(server.id)}
					/>
				))}
			</div>
			{error && <Message tone='error'>{error}</Message>}
			<Button variant='outline' onClick={() => navigateTo({ name: 'add-server' })}>
				<Plus />
				Add a server
			</Button>
		</ScreenLayout>
	);
}

function ServerRow({
	server,
	disabled,
	onSelect,
	onRemove,
}: {
	server: Server;
	disabled: boolean;
	onSelect: () => void;
	onRemove: () => void;
}) {
	const [isConfirmingRemoval, setIsConfirmingRemoval] = useState(false);
	const Icon = server.builtIn ? Cloud : ServerIcon;

	return (
		<div className='group flex items-center gap-1 rounded-xl border border-border bg-card pr-2 shadow-sm'>
			<button
				type='button'
				disabled={disabled}
				onClick={onSelect}
				className='flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-violet/50 disabled:cursor-default'
			>
				<Icon className='size-5 shrink-0 text-violet' />
				<span className='flex min-w-0 flex-1 flex-col'>
					<span className='truncate text-sm font-medium'>{server.name}</span>
					<span className='truncate text-xs text-muted-foreground'>
						{displayHost(server.url)} · {formatLastUsed(server.lastUsedAt, Date.now())}
					</span>
				</span>
				{isInsecureServerUrl(server.url) && (
					<span className='rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning'>Not secure</span>
				)}
				<ChevronRight className='size-4 shrink-0 text-muted-foreground' />
			</button>
			{!server.builtIn &&
				(isConfirmingRemoval ? (
					<Button variant='destructive' className='h-8 px-2' onClick={onRemove}>
						Remove
					</Button>
				) : (
					<Button
						variant='ghost'
						className='h-8 w-8 px-0'
						aria-label={`Remove ${server.name}`}
						onClick={() => setIsConfirmingRemoval(true)}
					>
						<Trash2 />
					</Button>
				))}
		</div>
	);
}
