import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordField } from '@/components/ui/form-fields';
import { cn } from '@/lib/utils';

export type SlackTransportMode = 'webhook' | 'socket';

export interface SlackFormProps {
	webhookUrl: string;
	hasProjectConfig: boolean;
	onSubmit: (values: {
		botToken: string;
		signingSecret: string;
		appToken: string;
		transportMode: SlackTransportMode;
	}) => Promise<void>;
	onCancel: () => void;
	isPending: boolean;
}

function buildSlackManifest(webhookUrl: string, mentionName: string, transportMode: SlackTransportMode) {
	const name = mentionName.trim() || 'nao';
	const isSocket = transportMode === 'socket';
	return {
		display_information: {
			name,
			description: 'Analytics agent for data queries',
			background_color: '#522bff',
		},
		features: {
			app_home: {
				messages_tab_enabled: true,
				messages_tab_read_only_enabled: false,
			},
			bot_user: {
				display_name: name,
				always_online: true,
			},
		},
		oauth_config: {
			scopes: {
				bot: [
					'channels:history',
					'channels:read',
					'groups:history',
					'groups:read',
					'im:history',
					'im:read',
					'mpim:history',
					'mpim:read',
					'reactions:read',
					'reactions:write',
					'app_mentions:read',
					'users:read',
					'users:read.email',
					'chat:write',
					'chat:write.public',
					'files:write',
				],
			},
		},
		settings: {
			event_subscriptions: {
				...(isSocket ? {} : { request_url: webhookUrl }),
				bot_events: ['app_mention', 'message.channels', 'message.groups', 'message.im', 'message.mpim'],
			},
			interactivity: {
				is_enabled: true,
				...(isSocket ? {} : { request_url: webhookUrl }),
			},
			org_deploy_enabled: false,
			socket_mode_enabled: isSocket,
			token_rotation_enabled: false,
		},
	};
}

function buildManifestUrl(webhookUrl: string, mentionName: string, transportMode: SlackTransportMode): string {
	const manifest = buildSlackManifest(webhookUrl, mentionName, transportMode);
	return `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(manifest))}`;
}

export function SlackForm({ webhookUrl, hasProjectConfig, onSubmit, onCancel, isPending }: SlackFormProps) {
	const [mentionName, setMentionName] = useState('nao');
	const [transportMode, setTransportMode] = useState<SlackTransportMode>('webhook');

	const form = useForm({
		defaultValues: { botToken: '', signingSecret: '', appToken: '' },
		onSubmit: async ({ value }) => {
			await onSubmit({ ...value, transportMode });
			form.reset();
		},
	});

	const isSocket = transportMode === 'socket';
	const manifestUrl = isSocket
		? buildManifestUrl('', mentionName, transportMode)
		: webhookUrl
			? buildManifestUrl(webhookUrl, mentionName, transportMode)
			: '';

	return (
		<div className='flex flex-col gap-4 p-4 rounded-lg border border-primary/50 bg-muted/30'>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					form.handleSubmit();
				}}
				className='flex flex-col gap-4'
			>
				<div className='flex items-center justify-between'>
					<span className='text-sm font-medium text-foreground'>Slack</span>
					<Button variant='ghost' size='icon-sm' type='button' onClick={onCancel}>
						<X className='size-4' />
					</Button>
				</div>
				<p className='text-[11px] text-muted-foreground leading-relaxed'>
					<a
						href='https://docs.getnao.io/nao-agent/chat/slack'
						target='_blank'
						rel='noopener noreferrer'
						className='inline-flex items-center gap-1 underline hover:text-foreground'
					>
						See how to set up the Slack integration
						<ExternalLink className='size-3' />
					</a>
				</p>

				{/* Transport mode */}
				<div className='grid gap-2'>
					<label className='text-xs font-medium text-foreground'>Transport mode</label>
					<div className='inline-flex rounded-md border border-input bg-background p-0.5 w-fit'>
						<button
							type='button'
							onClick={() => setTransportMode('webhook')}
							className={cn(
								'px-3 py-1 text-xs rounded-sm transition-colors',
								transportMode === 'webhook'
									? 'bg-primary text-primary-foreground'
									: 'text-muted-foreground hover:text-foreground',
							)}
						>
							Webhook
						</button>
						<button
							type='button'
							onClick={() => setTransportMode('socket')}
							className={cn(
								'px-3 py-1 text-xs rounded-sm transition-colors',
								transportMode === 'socket'
									? 'bg-primary text-primary-foreground'
									: 'text-muted-foreground hover:text-foreground',
							)}
						>
							Socket Mode
						</button>
					</div>
					<p className='text-[11px] text-muted-foreground leading-relaxed'>
						{isSocket
							? 'Socket Mode opens an outbound WebSocket to Slack — use this when nao runs in a private VPC or air-gapped environment.'
							: 'Webhook mode (default) requires nao to be reachable from the internet.'}
					</p>
				</div>

				{/* Mention name */}
				<div className='grid gap-2'>
					<label htmlFor='mention-name' className='text-xs font-medium text-foreground'>
						Bot mention name
					</label>
					<Input
						id='mention-name'
						type='text'
						value={mentionName}
						onChange={(e) => setMentionName(e.target.value)}
						placeholder='nao'
						className='text-xs h-8'
					/>
					<p className='text-[11px] text-muted-foreground'>
						The name users will use to mention the bot (e.g. @nao).
					</p>
				</div>

				{/* Step 2 */}
				<div className='grid gap-2'>
					<Button type='button' size='sm' variant='outline' disabled={!manifestUrl} asChild>
						<a href={manifestUrl || undefined} target='_blank' rel='noopener noreferrer'>
							<ExternalLink className='size-3.5 mr-1.5' />
							Create Slack App
						</a>
					</Button>
				</div>

				{/* Step 3 */}
				<div className='grid gap-3'>
					<p className='text-xs font-medium text-foreground'>3. Enter your app credentials</p>
					{isSocket ? (
						<>
							<p className='text-[11px] text-muted-foreground leading-relaxed'>
								After creating the app, install it. Then find the <strong>Bot User OAuth Token</strong>{' '}
								under <strong>OAuth &amp; Permissions</strong>, and generate an{' '}
								<strong>App-Level Token</strong> with the <code>connections:write</code> scope under{' '}
								<strong>Basic Information</strong>.
							</p>
							<PasswordField
								form={form}
								name='appToken'
								label='App-Level Token'
								placeholder='xapp-...'
								required
							/>
							<PasswordField
								form={form}
								name='botToken'
								label='Bot Token'
								placeholder='xoxb-...'
								required
							/>
						</>
					) : (
						<>
							<p className='text-[11px] text-muted-foreground leading-relaxed'>
								After creating the app, install it. Then find these in your Slack App settings under{' '}
								<strong>OAuth &amp; Permissions</strong> (Bot Token) and{' '}
								<strong>Basic Information</strong> (Signing Secret).
							</p>
							<PasswordField
								form={form}
								name='signingSecret'
								label='Signing Secret'
								placeholder='Enter your Slack signing secret'
								required
							/>
							<PasswordField
								form={form}
								name='botToken'
								label='Bot Token'
								placeholder='xoxb-...'
								required
							/>
						</>
					)}
				</div>

				<div className='flex justify-end gap-2 pt-2'>
					<Button variant='ghost' size='sm' type='button' onClick={onCancel}>
						Cancel
					</Button>
					<form.Subscribe selector={(state: { canSubmit: boolean }) => state.canSubmit}>
						{(canSubmit: boolean) => (
							<Button size='sm' type='submit' disabled={!canSubmit || isPending}>
								{hasProjectConfig ? 'Update' : 'Save'}
							</Button>
						)}
					</form.Subscribe>
				</div>
			</form>
		</div>
	);
}
