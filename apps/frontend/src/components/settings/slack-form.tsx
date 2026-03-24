import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordField } from '@/components/ui/form-fields';

export interface SlackFormProps {
	webhookUrl: string;
	hasProjectConfig: boolean;
	onSubmit: (values: { botToken: string; signingSecret: string }) => Promise<void>;
	onCancel: () => void;
	isPending: boolean;
}

function buildSlackManifest(webhookUrl: string, mentionName: string) {
	const name = mentionName.trim() || 'nao';
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
					'files:write',
				],
			},
		},
		settings: {
			event_subscriptions: {
				request_url: webhookUrl,
				bot_events: ['app_mention', 'message.channels', 'message.groups', 'message.im', 'message.mpim'],
			},
			interactivity: {
				is_enabled: true,
				request_url: webhookUrl,
			},
			org_deploy_enabled: false,
			socket_mode_enabled: false,
			token_rotation_enabled: false,
		},
	};
}

function buildManifestUrl(webhookUrl: string, mentionName: string): string {
	const manifest = buildSlackManifest(webhookUrl, mentionName);
	return `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(manifest))}`;
}

export function SlackForm({ webhookUrl, hasProjectConfig, onSubmit, onCancel, isPending }: SlackFormProps) {
	const [mentionName, setMentionName] = useState('nao');

	const form = useForm({
		defaultValues: { botToken: '', signingSecret: '' },
		onSubmit: async ({ value }) => {
			await onSubmit(value);
			form.reset();
		},
	});

	const manifestUrl = webhookUrl ? buildManifestUrl(webhookUrl, mentionName) : '';

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
					<p className='text-[11px] text-muted-foreground leading-relaxed'>
						After creating the app, install it. Then find these in your Slack App settings under{' '}
						<strong>OAuth &amp; Permissions</strong> (Bot Token) and <strong>Basic Information</strong>{' '}
						(Signing Secret).
					</p>
					<PasswordField form={form} name='botToken' label='Bot Token' placeholder='xoxb-...' required />
					<PasswordField
						form={form}
						name='signingSecret'
						label='Signing Secret'
						placeholder='Enter your Slack signing secret'
						required
					/>
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
