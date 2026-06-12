import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { SlackForm } from './slack-form';
import { Button } from '@/components/ui/button';
import { CopyableUrl } from '@/components/ui/copyable-url';
import { FormError } from '@/components/ui/form-fields';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/main';

interface SlackConfigSectionProps {
	isAdmin: boolean;
}

export function SlackConfigSection({ isAdmin }: SlackConfigSectionProps) {
	const queryClient = useQueryClient();
	const slackConfig = useQuery(trpc.project.getSlackConfig.queryOptions());
	const { data: availableModels } = useQuery(trpc.project.listAvailableTranscribeModels.queryOptions());

	const [isEditing, setIsEditing] = useState(false);
	type AvailableModel = NonNullable<typeof availableModels>[number];
	const [selectedModel, setSelectedModel] = useState<AvailableModel | null>(null);

	const projectConfig = slackConfig.data?.projectConfig;
	const webhookUrl = slackConfig.data?.webhookUrl ?? '';
	const transportMode = projectConfig?.transportMode ?? 'webhook';
	const replyMode = projectConfig?.replyMode ?? 'thread';

	useEffect(() => {
		if (!availableModels || availableModels.length === 0) {
			return;
		}
		const persisted = projectConfig?.modelSelection;
		const match =
			persisted &&
			availableModels.find((m) => m.provider === persisted.provider && m.modelId === persisted.modelId);
		setSelectedModel(match || availableModels[0]);
	}, [availableModels, projectConfig]);

	const upsertSlackConfig = useMutation(trpc.project.upsertSlackConfig.mutationOptions());
	const updateSlackModel = useMutation(trpc.project.updateSlackModelConfig.mutationOptions());
	const updateSlackReplyMode = useMutation(trpc.project.updateSlackReplyMode.mutationOptions());
	const deleteSlackConfig = useMutation(trpc.project.deleteSlackConfig.mutationOptions());

	const handleSubmit = async (values: {
		botToken: string;
		signingSecret: string;
		appToken: string;
		transportMode: 'webhook' | 'socket';
	}) => {
		await upsertSlackConfig.mutateAsync({
			...values,
			modelProvider: selectedModel?.provider,
			modelId: selectedModel?.modelId,
		});
		queryClient.invalidateQueries(trpc.project.getSlackConfig.queryOptions());
		setIsEditing(false);
	};

	const handleDelete = async () => {
		await deleteSlackConfig.mutateAsync();
		queryClient.removeQueries(trpc.project.getSlackConfig.queryOptions());
	};

	const handleStartEditing = () => {
		const persisted = projectConfig?.modelSelection;
		const match =
			persisted &&
			availableModels?.find((m) => m.provider === persisted.provider && m.modelId === persisted.modelId);
		setSelectedModel(match || (availableModels?.[0] ?? null));
		setIsEditing(true);
	};

	const handleModelChange = useCallback(
		async (value: string) => {
			const model = availableModels?.find((m) => `${m.provider}:${m.modelId}` === value);
			if (model) {
				setSelectedModel(model);
				await updateSlackModel.mutateAsync({ modelProvider: model.provider, modelId: model.modelId });
				queryClient.invalidateQueries(trpc.project.getSlackConfig.queryOptions());
			}
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[availableModels, queryClient],
	);

	const handleReplyModeChange = useCallback(
		async (onlyWhenMentioned: boolean) => {
			updateSlackReplyMode.mutate(
				{ replyMode: onlyWhenMentioned ? 'mention' : 'thread' },
				{
					onSuccess: () => {
						void queryClient.invalidateQueries(trpc.project.getSlackConfig.queryOptions());
					},
				},
			);
		},
		[queryClient, updateSlackReplyMode],
	);

	if (!isAdmin) {
		return (
			<SettingsCard title='Connection' description='Your Slack app credentials'>
				{projectConfig ? (
					<div className='grid gap-1'>
						<span className='text-sm font-medium text-foreground'>Slack App</span>
						<span className='text-xs text-muted-foreground'>
							Transport: {transportMode === 'socket' ? 'Socket Mode' : 'Webhook'}
						</span>
						<span className='text-xs text-muted-foreground'>
							Replies:{' '}
							{replyMode === 'mention' ? 'Only when mentioned' : 'Every message in active threads'}
						</span>
						<span className='text-xs font-mono text-muted-foreground'>
							Bot Token: {projectConfig.botTokenPreview}
						</span>
						{transportMode === 'socket' ? (
							projectConfig.appTokenPreview && (
								<span className='text-xs font-mono text-muted-foreground'>
									App Token: {projectConfig.appTokenPreview}
								</span>
							)
						) : (
							<span className='text-xs font-mono text-muted-foreground'>
								Signing Secret: {projectConfig.signingSecretPreview}
							</span>
						)}
					</div>
				) : (
					<p className='text-sm text-muted-foreground'>
						No Slack integration configured. Contact an admin to set it up.
					</p>
				)}
			</SettingsCard>
		);
	}

	if (isEditing || !projectConfig) {
		return (
			<SlackForm
				webhookUrl={webhookUrl}
				hasProjectConfig={!!projectConfig}
				onSubmit={handleSubmit}
				onCancel={() => setIsEditing(false)}
				isPending={upsertSlackConfig.isPending}
			/>
		);
	}

	const hasMultipleModels = Boolean(availableModels && availableModels.length > 1);

	return (
		<div className='flex flex-col gap-6'>
			<SettingsCard title='Connection' description='Your Slack app credentials'>
				<div className='flex items-center gap-4'>
					<div className='flex-1 grid gap-1'>
						<span className='text-sm font-medium text-foreground'>Slack App</span>
						<span className='text-xs text-muted-foreground'>
							Transport: {transportMode === 'socket' ? 'Socket Mode' : 'Webhook'}
						</span>
						<span className='text-xs text-muted-foreground'>
							Replies:{' '}
							{replyMode === 'mention' ? 'Only when mentioned' : 'Every message in active threads'}
						</span>
						<span className='text-xs font-mono text-muted-foreground'>
							Bot Token: {projectConfig.botTokenPreview}
						</span>
						{transportMode === 'socket' ? (
							projectConfig.appTokenPreview && (
								<span className='text-xs font-mono text-muted-foreground'>
									App Token: {projectConfig.appTokenPreview}
								</span>
							)
						) : (
							<span className='text-xs font-mono text-muted-foreground'>
								Signing Secret: {projectConfig.signingSecretPreview}
							</span>
						)}
					</div>
					<div className='flex gap-1'>
						<Button variant='ghost' size='icon-sm' onClick={handleStartEditing}>
							<Pencil className='size-3 text-muted-foreground' />
						</Button>
						<Button
							variant='ghost'
							size='icon-sm'
							onClick={handleDelete}
							disabled={deleteSlackConfig.isPending}
						>
							<Trash2 className='size-4 text-destructive' />
						</Button>
					</div>
				</div>
			</SettingsCard>

			{transportMode === 'webhook' && webhookUrl && (
				<SettingsCard title='Webhook' description='Register this URL in your Slack app settings'>
					<CopyableUrl url={webhookUrl} />
				</SettingsCard>
			)}

			{transportMode === 'socket' && (
				<SettingsCard
					title='Socket Mode'
					description='nao maintains an outbound WebSocket connection to Slack — no public webhook URL is required.'
				>
					<p className='text-xs text-muted-foreground'>
						Make sure Socket Mode is enabled in your Slack app settings and that the App-Level Token has the{' '}
						<code>connections:write</code> scope.
					</p>
				</SettingsCard>
			)}

			<SettingsCard title='Settings' description='Configure how the Slack bot behaves'>
				<div className='grid gap-6'>
					<SettingsControlRow
						id='slack-reply-only-when-mentioned'
						label='Reply only when mentioned'
						description='When enabled, nao reads thread context but only answers messages that tag the bot.'
						control={
							<Switch
								id='slack-reply-only-when-mentioned'
								checked={replyMode === 'mention'}
								onCheckedChange={handleReplyModeChange}
								disabled={updateSlackReplyMode.isPending}
							/>
						}
					/>
					<div className='grid gap-2'>
						<label className='text-sm font-medium text-foreground'>Model</label>
						<p className='text-xs text-muted-foreground'>
							The model used to answer questions asked in Slack.
						</p>
						{hasMultipleModels ? (
							<Select
								value={selectedModel ? `${selectedModel.provider}:${selectedModel.modelId}` : undefined}
								onValueChange={handleModelChange}
								disabled={updateSlackModel.isPending}
							>
								<SelectTrigger className='w-full'>
									<SelectValue>
										{selectedModel && (
											<div className='flex items-center gap-2'>
												<LlmProviderIcon provider={selectedModel.provider} className='size-4' />
												{selectedModel.name}
											</div>
										)}
									</SelectValue>
								</SelectTrigger>
								<SelectContent>
									{availableModels?.map((model) => (
										<SelectItem
											key={`${model.provider}-${model.modelId}`}
											value={`${model.provider}:${model.modelId}`}
										>
											<LlmProviderIcon provider={model.provider} className='size-4' />
											{model.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						) : (
							selectedModel && (
								<div className='flex items-center gap-2 text-sm text-muted-foreground'>
									<LlmProviderIcon provider={selectedModel.provider} className='size-4' />
									<span>{selectedModel.name}</span>
								</div>
							)
						)}
					</div>
				</div>
			</SettingsCard>

			<AutoCreateUsersCard
				enabled={projectConfig.autoCreateUsersEnabled ?? false}
				domains={projectConfig.autoCreateUsersDomains ?? []}
			/>
		</div>
	);
}

interface AutoCreateUsersCardProps {
	enabled: boolean;
	domains: string[];
}

function AutoCreateUsersCard({ enabled: initialEnabled, domains: initialDomains }: AutoCreateUsersCardProps) {
	const queryClient = useQueryClient();
	const [enabled, setEnabled] = useState(initialEnabled);
	const [domainsText, setDomainsText] = useState(initialDomains.join(', '));
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setEnabled(initialEnabled);
		setDomainsText(initialDomains.join(', '));
	}, [initialEnabled, initialDomains]);

	const parsedDomains = useMemo(() => parseDomains(domainsText), [domainsText]);

	const hasChanges = useMemo(() => {
		if (enabled !== initialEnabled) {
			return true;
		}
		if (parsedDomains.length !== initialDomains.length) {
			return true;
		}
		return parsedDomains.some((d, i) => d !== initialDomains[i]);
	}, [enabled, initialEnabled, parsedDomains, initialDomains]);

	const updateMutation = useMutation(
		trpc.project.updateSlackAutoCreateUsers.mutationOptions({
			onSuccess: () => {
				setError(null);
				queryClient.invalidateQueries(trpc.project.getSlackConfig.queryOptions());
			},
			onError: (err) => {
				setError(err.message);
			},
		}),
	);

	const handleSave = () => {
		if (enabled && parsedDomains.length === 0) {
			setError('Add at least one allowed domain to enable auto-creation.');
			return;
		}
		updateMutation.mutate({ enabled, domains: parsedDomains });
	};

	return (
		<SettingsCard
			title='Auto-create users from Slack'
			description='Automatically provision a nao account for senders whose email domain is allowed.'
		>
			<SettingsControlRow
				id='slack-auto-create-users'
				label='Enable auto-creation'
				description='New users receive an email with a temporary password and are added to this project only.'
				control={
					<Switch
						id='slack-auto-create-users'
						checked={enabled}
						onCheckedChange={(value) => {
							setEnabled(value);
							setError(null);
						}}
						disabled={updateMutation.isPending}
					/>
				}
			/>
			<div className='grid gap-2'>
				<label htmlFor='slack-auto-create-domains' className='text-sm font-medium text-foreground'>
					Allowed email domains
				</label>
				<p className='text-xs text-muted-foreground'>
					Comma-separated list (e.g. <code>example.com, company.org</code>). Only Slack users with these
					domains are auto-provisioned.
				</p>
				<Textarea
					id='slack-auto-create-domains'
					value={domainsText}
					onChange={(e) => {
						setDomainsText(e.target.value);
						setError(null);
					}}
					placeholder='example.com, company.org'
					rows={2}
					disabled={!enabled || updateMutation.isPending}
				/>
			</div>
			<FormError error={error ?? undefined} />
			<div className='flex justify-end'>
				<Button size='sm' onClick={handleSave} disabled={!hasChanges || updateMutation.isPending}>
					{updateMutation.isPending ? 'Saving…' : 'Save'}
				</Button>
			</div>
		</SettingsCard>
	);
}

function parseDomains(raw: string): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const entry of raw.split(/[\s,]+/)) {
		const trimmed = entry.trim().toLowerCase();
		if (trimmed && !seen.has(trimmed)) {
			seen.add(trimmed);
			result.push(trimmed);
		}
	}
	return result;
}
