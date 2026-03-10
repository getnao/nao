import { useEffect, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordField } from '@/components/ui/form-fields';

export interface SlackFormProps {
	projectId?: string;
	redirectUrl?: string;
	hasProjectConfig: boolean;
	onSubmit: (values: { botToken: string; signingSecret: string }) => Promise<void>;
	onCancel: () => void;
	isPending: boolean;
}

function buildSlackManifest(webhookUrl: string) {
	return {
		display_information: {
			name: 'nao',
			description: 'Analytics agent for data queries',
			background_color: '#522bff',
		},
		features: {
			app_home: {
				messages_tab_enabled: true,
				messages_tab_read_only_enabled: false,
			},
			bot_user: {
				display_name: 'nao',
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
					'users.profile:read',
					'chat:write',
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

function buildManifestUrl(webhookUrl: string): string {
	const manifest = buildSlackManifest(webhookUrl);
	return `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(manifest))}`;
}

function isValidUrl(value: string): boolean {
	try {
		new URL(value);
		return true;
	} catch {
		return false;
	}
}

function normalizeUrl(value: string): string {
	return value.trim().replace(/\/+$/, '');
}

export function SlackForm({ projectId, redirectUrl, hasProjectConfig, onSubmit, onCancel, isPending }: SlackFormProps) {
	const [deploymentUrl, setDeploymentUrl] = useState(redirectUrl ?? '');

	useEffect(() => {
		if (redirectUrl) {
			setDeploymentUrl(redirectUrl);
		}
	}, [redirectUrl]);

	console.log('Current deploymentUrl state:', deploymentUrl);

	const form = useForm({
		defaultValues: { botToken: '', signingSecret: '' },
		onSubmit: async ({ value }) => {
			await onSubmit(value);
			form.reset();
		},
	});

	const normalized = normalizeUrl(deploymentUrl);
	const valid = isValidUrl(normalized);
	const webhookUrl = valid && projectId ? `${normalized}/api/webhooks/slack/${projectId}` : '';
	const manifestUrl = webhookUrl ? buildManifestUrl(webhookUrl) : '';

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

				{/* Step 1 */}
				<div className='grid gap-2'>
					<label htmlFor='deployment-url' className='text-xs font-medium text-foreground'>
						1. What is your deployment URL?
					</label>
					<Input
						id='deployment-url'
						type='url'
						value={deploymentUrl}
						onChange={(e) => setDeploymentUrl(e.target.value)}
						placeholder='https://my-app.com'
						className='text-xs h-8'
					/>
					{deploymentUrl && !valid && (
						<p className='text-[11px] text-destructive'>Enter a valid URL (e.g. https://my-app.com)</p>
					)}
				</div>

				{/* Step 2 */}
				<div className='grid gap-2'>
					<p className='text-xs font-medium text-foreground'>2. Create your Slack App</p>
					<p className='text-[11px] text-muted-foreground leading-relaxed'>
						Click to open Slack with a pre-filled app manifest — scopes, event subscriptions, and
						interactivity are configured automatically.
					</p>
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
					<PasswordField
						form={form}
						name='signingSecret'
						label='Signing Secret'
						placeholder='Enter your Slack signing secret'
						required
					/>
					<PasswordField form={form} name='botToken' label='Bot Token' placeholder='xoxb-...' required />
				</div>

				<div className='flex justify-end gap-2 pt-2'>
					<Button variant='ghost' size='sm' type='button' onClick={onCancel}>
						Cancel
					</Button>
					<form.Subscribe selector={(state: { canSubmit: boolean }) => state.canSubmit}>
						{(canSubmit: boolean) => (
							<Button size='sm' type='submit' disabled={!canSubmit || isPending}>
								{hasProjectConfig ? 'Update' : 'Add'}
							</Button>
						)}
					</form.Subscribe>
				</div>
			</form>
		</div>
	);
}
