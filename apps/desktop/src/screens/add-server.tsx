import { type FormEvent, useState } from 'react';

import { Button } from '@/components/button';
import { Message } from '@/components/message';
import { Panel, ScreenLayout } from '@/components/screen-layout';
import { useAction } from '@/hooks/use-action';
import { addServer, selectServer } from '@/lib/commands';
import { navigateTo } from '@/lib/routes';
import { isInsecureServerUrl } from '@/lib/servers';

export function AddServer() {
	const [url, setUrl] = useState('');
	const [name, setName] = useState('');
	const add = useAction(async () => {
		const server = await addServer(url, name);
		await selectServer(server.id);
	});

	const submit = (event: FormEvent) => {
		event.preventDefault();
		void add.run();
	};

	return (
		<ScreenLayout title='Add a server' description='Enter the address of your nao instance.'>
			<form onSubmit={submit}>
				<Panel>
					<Field label='Server URL'>
						<input
							autoFocus
							required
							name='url'
							value={url}
							onChange={(event) => setUrl(event.target.value)}
							placeholder='nao.your-company.com'
							autoCapitalize='off'
							autoCorrect='off'
							spellCheck={false}
							className={INPUT_CLASSES}
						/>
					</Field>
					<Field label='Name (optional)'>
						<input
							name='name'
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder='Acme analytics'
							className={INPUT_CLASSES}
						/>
					</Field>
					{isInsecureServerUrl(url) && (
						<Message tone='warning'>
							This server uses http://, so your session and data are sent unencrypted. Only use it on a
							network you trust.
						</Message>
					)}
					{add.error && <Message tone='error'>{add.error}</Message>}
					<div className='flex justify-end gap-2'>
						<Button variant='outline' onClick={() => navigateTo({ name: 'servers' })}>
							Cancel
						</Button>
						<Button type='submit' isLoading={add.isPending} disabled={!url.trim()}>
							Add server
						</Button>
					</div>
				</Panel>
			</form>
		</ScreenLayout>
	);
}

const INPUT_CLASSES =
	'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-violet/50';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<label className='flex flex-col gap-1.5 text-sm font-medium'>
			{label}
			{children}
		</label>
	);
}
