import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { CopyableUrl } from '@/components/ui/copyable-url';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trpc } from '@/main';

interface SlackConfigSectionProps {
	isAdmin: boolean;
}

function SlackAppConfigUrls({
	eventSubscriptionUrl,
	interactivityUrl,
}: {
	eventSubscriptionUrl: string;
	interactivityUrl: string;
}) {
	const [appId, setAppId] = useState('');

	const slackEventSubscriptionsUrl = appId ? `https://api.slack.com/apps/${appId}/event-subscriptions?` : '';
	const slackInteractiveMessagesUrl = appId ? `https://api.slack.com/apps/${appId}/interactive-messages?` : '';

	return (
		<div className='p-4 rounded-lg border border-border bg-muted/20'>
			<h5 className='text-xs font-medium text-foreground mb-3'>Slack App Configuration URLs</h5>
			<p className='text-xs text-muted-foreground mb-3'>Add these URLs to your Slack App settings:</p>

			{/* App ID input for quick links */}
			<div className='mb-4 p-3 rounded border border-border bg-background/50'>
				<label htmlFor='slack-app-id' className='text-xs font-medium text-foreground block mb-2'>
					Slack App ID (optional, for quick links)
				</label>
				<Input
					id='slack-app-id'
					type='text'
					value={appId}
					onChange={(e) => setAppId(e.target.value)}
					placeholder='e.g. A0A9937DI4L'
					className='text-xs h-8'
				/>
				{appId && (
					<div className='mt-2 flex flex-col gap-1.5'>
						<a
							href={slackEventSubscriptionsUrl}
							target='_blank'
							rel='noopener noreferrer'
							className='inline-flex items-center gap-1.5 text-xs text-primary hover:underline'
						>
							<ExternalLink className='size-3' />
							Open Event Subscriptions settings
						</a>
						<a
							href={slackInteractiveMessagesUrl}
							target='_blank'
							rel='noopener noreferrer'
							className='inline-flex items-center gap-1.5 text-xs text-primary hover:underline'
						>
							<ExternalLink className='size-3' />
							Open Interactivity & Shortcuts settings
						</a>
					</div>
				)}
			</div>

			<div className='grid gap-3'>
				<div>
					<CopyableUrl label='Event Subscriptions → Request URL' url={eventSubscriptionUrl} />
					<p className='mt-1.5 text-[11px] text-muted-foreground leading-relaxed'>
						In Event Subscriptions, enable events and subscribe to bot events:{' '}
						<code className='px-1 py-0.5 bg-muted rounded text-[10px] font-semibold'>app_mention</code>
					</p>
				</div>
				<CopyableUrl label='Interactivity & Shortcuts → Request URL' url={interactivityUrl} />
			</div>
		</div>
	);
}

export function SlackConfigSection({ isAdmin }: SlackConfigSectionProps) {
	const queryClient = useQueryClient();
	const slackConfig = useQuery(trpc.project.getSlackConfig.queryOptions());

	const [isEditing, setIsEditing] = useState(false);
	const [botToken, setBotToken] = useState('');
	const [signingSecret, setSigningSecret] = useState('');

	const upsertSlackConfig = useMutation(trpc.project.upsertSlackConfig.mutationOptions());
	const deleteSlackConfig = useMutation(trpc.project.deleteSlackConfig.mutationOptions());

	const baseUrl = slackConfig.data?.redirectUrl || window.location.origin;
	const projectId = slackConfig.data?.projectId;
	const eventSubscriptionUrl = projectId ? `${baseUrl}/api/slack/events/${projectId}/app_mention` : '';
	const interactivityUrl = projectId ? `${baseUrl}/api/slack/events/${projectId}/interactions` : '';

	const projectConfig = slackConfig.data?.projectConfig;
	const hasEnvConfig = slackConfig.data?.hasEnvConfig ?? false;

	const handleSaveConfig = async () => {
		if (!botToken || !signingSecret) {
			return;
		}
		await upsertSlackConfig.mutateAsync({ botToken, signingSecret });
		queryClient.invalidateQueries(trpc.project.getSlackConfig.queryOptions());
		setIsEditing(false);
		setBotToken('');
		setSigningSecret('');
	};

	const handleDeleteConfig = async () => {
		await deleteSlackConfig.mutateAsync();
		queryClient.removeQueries(trpc.project.getSlackConfig.queryOptions());
	};

	const handleCancel = () => {
		setIsEditing(false);
		setBotToken('');
		setSigningSecret('');
	};

	return (
		<div className='grid gap-4 pt-4 border-t border-border'>
			<h4 className='text-sm font-medium text-foreground'>Slack Integration</h4>

			{/* Environment-configured Slack (read-only) */}
			{hasEnvConfig && !projectConfig && !isEditing && (
				<div className='flex items-center gap-4 p-4 rounded-lg border border-border bg-muted/30'>
					<div className='flex-1 grid gap-1'>
						<span className='text-sm font-medium text-foreground'>Slack</span>
						<span className='text-xs text-muted-foreground'>Configured from environment</span>
					</div>
					<div className='flex items-center gap-2 text-xs'>
						{isAdmin && (
							<Button variant='ghost' size='icon-sm' onClick={() => setIsEditing(true)}>
								<Pencil className='size-3 text-muted-foreground' />
							</Button>
						)}
						<span className='px-2 py-0.5 text-xs font-medium rounded bg-muted text-muted-foreground'>
							ENV
						</span>
					</div>
				</div>
			)}

			{/* Project-specific config (editable) */}
			{projectConfig && !isEditing && (
				<div className='flex items-center gap-4 p-4 rounded-lg border border-border bg-muted/30'>
					<div className='flex-1 grid gap-1'>
						<div className='flex items-center gap-2'>
							<span className='text-sm font-medium text-foreground'>Slack</span>
							{hasEnvConfig && (
								<span className='px-1.5 py-0.5 text-[10px] font-medium rounded bg-primary/10 text-primary'>
									Override
								</span>
							)}
						</div>
						<div className='grid gap-0.5'>
							<span className='text-xs font-mono text-muted-foreground'>
								Bot Token: {projectConfig.botTokenPreview}
							</span>
							<span className='text-xs font-mono text-muted-foreground'>
								Signing Secret: {projectConfig.signingSecretPreview}
							</span>
						</div>
					</div>
					{isAdmin && (
						<div className='flex gap-1'>
							<Button variant='ghost' size='icon-sm' onClick={() => setIsEditing(true)}>
								<Pencil className='size-4 text-muted-foreground' />
							</Button>
							<Button
								variant='ghost'
								size='icon-sm'
								onClick={handleDeleteConfig}
								disabled={deleteSlackConfig.isPending}
							>
								<Trash2 className='size-4 text-destructive' />
							</Button>
						</div>
					)}
				</div>
			)}

			{/* Slack App Setup URLs - shown when Slack is configured */}
			{(hasEnvConfig || projectConfig) && !isEditing && eventSubscriptionUrl && (
				<SlackAppConfigUrls eventSubscriptionUrl={eventSubscriptionUrl} interactivityUrl={interactivityUrl} />
			)}

			{/* Add/Edit config form (admin only) */}
			{isAdmin && (isEditing || (!projectConfig && !hasEnvConfig)) && (
				<div className='flex flex-col gap-3 p-4 rounded-lg border border-dashed border-border'>
					<div className='grid gap-4'>
						<div className='grid gap-2'>
							<label htmlFor='slack-bot-token' className='text-sm font-medium text-foreground'>
								Bot Token
							</label>
							<Input
								id='slack-bot-token'
								type='password'
								value={botToken}
								onChange={(e) => setBotToken(e.target.value)}
								placeholder='xoxb-...'
							/>
						</div>
						<div className='grid gap-2'>
							<label htmlFor='slack-signing-secret' className='text-sm font-medium text-foreground'>
								Signing Secret
							</label>
							<Input
								id='slack-signing-secret'
								type='password'
								value={signingSecret}
								onChange={(e) => setSigningSecret(e.target.value)}
								placeholder='Enter your Slack signing secret'
							/>
						</div>
					</div>
					<div className='flex justify-end gap-2'>
						{(isEditing || projectConfig || hasEnvConfig) && (
							<Button variant='ghost' size='sm' onClick={handleCancel}>
								Cancel
							</Button>
						)}
						<Button
							size='sm'
							onClick={handleSaveConfig}
							disabled={!botToken || !signingSecret || upsertSlackConfig.isPending}
						>
							<Plus className='size-4 mr-1' />
							{projectConfig ? 'Update' : hasEnvConfig ? 'Add Override' : 'Add'}
						</Button>
					</div>
				</div>
			)}

			{!projectConfig && !hasEnvConfig && !isAdmin && (
				<p className='text-sm text-muted-foreground'>
					No Slack integration configured. Contact an admin to set it up.
				</p>
			)}
		</div>
	);
}
