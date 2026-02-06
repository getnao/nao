import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { CopyableUrl } from '@/components/ui/copyable-url';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trpc } from '@/main';
import { PasswordField } from '@/components/ui/form-fields';

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

	const upsertSlackConfig = useMutation(trpc.project.upsertSlackConfig.mutationOptions());
	const deleteSlackConfig = useMutation(trpc.project.deleteSlackConfig.mutationOptions());

	const baseUrl = slackConfig.data?.redirectUrl || window.location.origin;
	const projectId = slackConfig.data?.projectId;
	const eventSubscriptionUrl = projectId ? `${baseUrl}/api/slack/events/${projectId}/app_mention` : '';
	const interactivityUrl = projectId ? `${baseUrl}/api/slack/events/${projectId}/interactions` : '';

	const projectConfig = slackConfig.data?.projectConfig;
	const hasEnvConfig = slackConfig.data?.hasEnvConfig ?? false;

	const form = useForm({
		defaultValues: {
			botToken: '',
			signingSecret: '',
		},
		onSubmit: async ({ value }) => {
			if (!value.botToken || !value.signingSecret) {
				return;
			}
			await upsertSlackConfig.mutateAsync(value);
			queryClient.invalidateQueries(trpc.project.getSlackConfig.queryOptions());
			setIsEditing(false);
			form.reset();
		},
	});

	const handleDeleteConfig = async () => {
		await deleteSlackConfig.mutateAsync();
		queryClient.removeQueries(trpc.project.getSlackConfig.queryOptions());
	};

	const handleCancel = () => {
		setIsEditing(false);
		form.reset();
	};

	return (
		<div className='grid gap-4'>
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
				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className='flex flex-col gap-3 p-4 rounded-lg border border-dashed border-border'
				>
					<div className='grid gap-4'>
						<PasswordField form={form} name='botToken' label='Bot Token' placeholder='xoxb-...' required />
						<PasswordField
							form={form}
							name='signingSecret'
							label='Signing Secret'
							placeholder='Enter your Slack signing secret'
							required
						/>
					</div>
					<div className='flex justify-end gap-2'>
						{(isEditing || projectConfig || hasEnvConfig) && (
							<Button variant='ghost' size='sm' onClick={handleCancel} type='button'>
								Cancel
							</Button>
						)}
						<form.Subscribe selector={(state: { canSubmit: boolean }) => state.canSubmit}>
							{(canSubmit: boolean) => (
								<Button size='sm' type='submit' disabled={!canSubmit || upsertSlackConfig.isPending}>
									<Plus className='size-4 mr-1' />
									{projectConfig ? 'Update' : hasEnvConfig ? 'Add Override' : 'Add'}
								</Button>
							)}
						</form.Subscribe>
					</div>
				</form>
			)}

			{!projectConfig && !hasEnvConfig && !isAdmin && (
				<p className='text-sm text-muted-foreground'>
					No Slack integration configured. Contact an admin to set it up.
				</p>
			)}
		</div>
	);
}
