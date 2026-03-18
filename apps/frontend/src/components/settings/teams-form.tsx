import { useEffect, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { extractBaseUrl } from '@nao/shared';
import { ExternalLink, X } from 'lucide-react';
import JSZip from 'jszip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordField } from '@/components/ui/form-fields';
import { isValidUrl, normalizeUrl } from '@/lib/utils';

export interface TeamsFormProps {
	hasProjectConfig: boolean;
	onSubmit: (values: {
		appId: string;
		appPassword: string;
		tenantId: string;
		deploymentUrl?: string;
	}) => Promise<void>;
	onCancel: () => void;
	isPending: boolean;
	messagingEndpointUrl: string | undefined;
}

export function buildTeamsManifest(appId: string, redirectUrl: string) {
	const url = new URL(redirectUrl);
	const domain = url.hostname;

	return {
		$schema: 'https://developer.microsoft.com/json-schemas/teams/v1.16/MicrosoftTeams.schema.json',
		manifestVersion: '1.16',
		version: '1.0.0',
		id: appId,
		developer: {
			name: 'Nao',
			websiteUrl: 'https://getnao.io/',
			privacyUrl: 'https://getnao.io/privacy',
			termsOfUseUrl: 'https://getnao.io/terms',
		},
		name: { short: 'nao', full: 'nao' },
		description: {
			short: 'Analytics agent for data queries',
			full: 'Analytics agent for data queries, providing insights and visualizations based on your data.',
		},
		icons: { outline: 'outline.png', color: 'color.png' },
		accentColor: '#FFFFFF',
		bots: [
			{
				botId: appId,
				scopes: ['personal', 'team', 'groupChat'],
				supportsFiles: true,
				isNotificationOnly: false,
			},
		],
		webApplicationInfo: {
			id: appId,
			resource: `api://${domain}/${appId}`,
		},
		permissions: ['identity', 'messageTeamMembers'],
		authorization: {
			permissions: {
				resourceSpecific: [
					{ name: 'ChannelMessage.Read.Group', type: 'Application' },
					{ name: 'ChatMessage.Read.Chat', type: 'Application' },
					{ name: 'Member.Read.Group', type: 'Application' },
				],
			},
		},
		validDomains: [domain],
	};
}

export async function downloadTeamsManifestZip(appId: string, redirectUrl: string) {
	const zip = new JSZip();

	zip.file('manifest.json', JSON.stringify(buildTeamsManifest(appId, redirectUrl), null, 2));

	const [outlineRes, colorRes] = await Promise.all([fetch('/outline.png'), fetch('/color.png')]);

	if (!outlineRes.ok || !colorRes.ok) {
		throw new Error('Failed to fetch app icon assets for the Teams manifest package.');
	}

	zip.file('outline.png', await outlineRes.arrayBuffer());
	zip.file('color.png', await colorRes.arrayBuffer());

	const blob = await zip.generateAsync({ type: 'blob' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = 'app.zip';
	a.click();
	URL.revokeObjectURL(url);
}

export function TeamsForm({ hasProjectConfig, onSubmit, onCancel, isPending, messagingEndpointUrl }: TeamsFormProps) {
	const [endpointUrl, setEndpointUrl] = useState(messagingEndpointUrl ?? '');

	useEffect(() => {
		setEndpointUrl(messagingEndpointUrl ?? '');
	}, [messagingEndpointUrl]);

	const form = useForm({
		defaultValues: { appId: '', appPassword: '', tenantId: '' },
		onSubmit: async ({ value }) => {
			const url = normalizeUrl(endpointUrl);
			const validatedUrl = isValidUrl(url) ? url : undefined;
			await onSubmit({ ...value, deploymentUrl: validatedUrl });
			if (validatedUrl) {
				const baseUrl = extractBaseUrl(validatedUrl);
				if (baseUrl) {
					await downloadTeamsManifestZip(value.appId, baseUrl);
				}
			}
			form.reset();
		},
	});

	const normalized = normalizeUrl(endpointUrl);
	const valid = isValidUrl(normalized);

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
					<span className='text-sm font-medium text-foreground'>Microsoft Teams</span>
					<Button variant='ghost' size='icon-sm' type='button' onClick={onCancel}>
						<X className='size-4' />
					</Button>
				</div>

				<div className='grid gap-3'>
					<p className='text-[11px] text-muted-foreground leading-relaxed'>
						<a
							href='https://docs.getnao.io/nao-agent/chat/microsoft_teams'
							target='_blank'
							rel='noopener noreferrer'
							className='inline-flex items-center gap-1 underline hover:text-foreground'
						>
							See how to set up the Teams integration
							<ExternalLink className='size-3' />
						</a>
					</p>

					<div className='grid gap-2'>
						<label htmlFor='teams-messaging-endpoint' className='text-xs font-medium text-foreground'>
							Messaging Endpoint URL
						</label>
						<Input
							id='teams-messaging-endpoint'
							type='url'
							value={endpointUrl}
							onChange={(e) => setEndpointUrl(e.target.value)}
							placeholder='https://my-app.com/api/webhooks/teams/...'
							className='text-xs h-8'
						/>
						{endpointUrl && !valid && (
							<p className='text-[11px] text-destructive'>
								Enter a valid URL (e.g. https://my-app.com/api/webhooks/teams/project-id)
							</p>
						)}
					</div>
					<PasswordField
						form={form}
						name='appId'
						label='App ID'
						placeholder='Enter your Teams App ID'
						required
					/>
					<PasswordField
						form={form}
						name='appPassword'
						label='App Password'
						placeholder='Enter your Teams App Password'
						required
					/>
					<PasswordField
						form={form}
						name='tenantId'
						label='Tenant ID'
						placeholder='Enter your Azure Tenant ID'
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
