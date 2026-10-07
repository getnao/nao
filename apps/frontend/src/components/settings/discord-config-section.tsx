import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { DiscordForm } from './discord-form';
import type { DiscordFormValues } from './discord-form';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { SettingsCard } from '@/components/ui/settings-card';
import { trpc } from '@/main';

interface DiscordConfigSectionProps {
	isAdmin: boolean;
	onCancelSetup: () => void;
}

export function DiscordConfigSection({ isAdmin, onCancelSetup }: DiscordConfigSectionProps) {
	const queryClient = useQueryClient();
	const discordConfig = useQuery(trpc.project.getDiscordConfig.queryOptions());
	const { data: availableModels } = useQuery(trpc.project.listAvailableTranscribeModels.queryOptions());

	const [isEditing, setIsEditing] = useState(false);
	type AvailableModel = NonNullable<typeof availableModels>[number];
	const [selectedModel, setSelectedModel] = useState<AvailableModel | null>(null);

	const projectConfig = discordConfig.data?.projectConfig;

	useEffect(() => {
		if (!availableModels || availableModels.length === 0) {
			return;
		}
		const persisted = projectConfig?.modelSelection;
		const match =
			persisted &&
			availableModels.find(
				(model) => model.provider === persisted.provider && model.modelId === persisted.modelId,
			);
		setSelectedModel(match || availableModels[0]);
	}, [availableModels, projectConfig]);

	const upsertDiscordConfig = useMutation(trpc.project.upsertDiscordConfig.mutationOptions());
	const updateDiscordModel = useMutation(trpc.project.updateDiscordModelConfig.mutationOptions());
	const deleteDiscordConfig = useMutation(trpc.project.deleteDiscordConfig.mutationOptions());

	const handleSubmit = async (values: DiscordFormValues) => {
		await upsertDiscordConfig.mutateAsync({
			botToken: values.botToken,
			applicationId: values.applicationId,
			publicKey: values.publicKey,
			mentionRoleIds: parseIdList(values.mentionRoleIds),
			respondToChannelIds: parseIdList(values.respondToChannelIds),
			fallbackUserEmail: values.fallbackUserEmail.trim() || undefined,
			hideAnswerLink: values.hideAnswerLink,
			modelProvider: selectedModel?.provider,
			modelId: selectedModel?.modelId,
		});
		queryClient.invalidateQueries(trpc.project.getDiscordConfig.queryOptions());
		setIsEditing(false);
	};

	const handleDelete = async () => {
		await deleteDiscordConfig.mutateAsync();
		queryClient.invalidateQueries(trpc.project.getDiscordConfig.queryOptions());
	};

	const handleCancel = () => {
		if (projectConfig) {
			setIsEditing(false);
			return;
		}
		onCancelSetup();
	};

	const handleStartEditing = () => {
		const persisted = projectConfig?.modelSelection;
		const match =
			persisted &&
			availableModels?.find(
				(model) => model.provider === persisted.provider && model.modelId === persisted.modelId,
			);
		setSelectedModel(match || (availableModels?.[0] ?? null));
		setIsEditing(true);
	};

	const handleModelChange = async (value: string) => {
		const model = availableModels?.find((candidate) => `${candidate.provider}:${candidate.modelId}` === value);
		if (!model) {
			return;
		}
		await updateDiscordModel.mutateAsync({ modelProvider: model.provider, modelId: model.modelId });
		setSelectedModel(model);
		queryClient.invalidateQueries(trpc.project.getDiscordConfig.queryOptions());
	};

	if (!isAdmin) {
		return (
			<SettingsCard title='Connection' description='Your Discord bot credentials'>
				{projectConfig ? (
					<DiscordConnectionDetails
						applicationId={projectConfig.applicationId}
						publicKey={projectConfig.publicKey}
						botTokenPreview={projectConfig.botTokenPreview}
						mentionRoleIds={projectConfig.mentionRoleIds}
						respondToChannelIds={projectConfig.respondToChannelIds}
					/>
				) : (
					<p className='text-sm text-muted-foreground'>
						No Discord integration configured. Contact an admin to set it up.
					</p>
				)}
			</SettingsCard>
		);
	}

	if (isEditing || !projectConfig) {
		return (
			<DiscordForm
				hasProjectConfig={Boolean(projectConfig)}
				initialApplicationId={projectConfig?.applicationId ?? ''}
				initialPublicKey={projectConfig?.publicKey ?? ''}
				initialMentionRoleIds={(projectConfig?.mentionRoleIds ?? []).join(', ')}
				initialRespondToChannelIds={(projectConfig?.respondToChannelIds ?? []).join(', ')}
				initialFallbackUserEmail={projectConfig?.fallbackUserEmail ?? ''}
				initialHideAnswerLink={projectConfig?.hideAnswerLink ?? false}
				onSubmit={handleSubmit}
				onCancel={handleCancel}
				isPending={upsertDiscordConfig.isPending}
			/>
		);
	}

	const hasMultipleModels = Boolean(availableModels && availableModels.length > 1);

	return (
		<div className='flex flex-col gap-6'>
			<SettingsCard title='Connection' description='Your Discord bot credentials'>
				<div className='flex items-center gap-4'>
					<div className='flex-1'>
						<DiscordConnectionDetails
							applicationId={projectConfig.applicationId}
							publicKey={projectConfig.publicKey}
							botTokenPreview={projectConfig.botTokenPreview}
							mentionRoleIds={projectConfig.mentionRoleIds}
							respondToChannelIds={projectConfig.respondToChannelIds}
						/>
					</div>
					<div className='flex gap-1'>
						<Button
							variant='ghost'
							size='icon-sm'
							aria-label='Edit Discord configuration'
							onClick={handleStartEditing}
						>
							<Pencil className='size-3 text-muted-foreground' />
						</Button>
						<Button
							variant='ghost'
							size='icon-sm'
							aria-label='Delete Discord configuration'
							onClick={handleDelete}
							disabled={deleteDiscordConfig.isPending}
						>
							<Trash2 className='size-4 text-destructive' />
						</Button>
					</div>
				</div>
			</SettingsCard>

			<SettingsCard title='Settings' description='Configure how the Discord bot behaves'>
				<div className='grid gap-2'>
					<label className='text-sm font-medium text-foreground'>Model</label>
					<p className='text-xs text-muted-foreground'>
						The model used to answer questions asked in Discord.
					</p>
					{hasMultipleModels ? (
						<Select
							value={selectedModel ? `${selectedModel.provider}:${selectedModel.modelId}` : undefined}
							onValueChange={handleModelChange}
							disabled={updateDiscordModel.isPending}
						>
							<SelectTrigger className='w-full' aria-label='Model'>
								<SelectValue>
									{selectedModel && (
										<div className='flex items-center gap-2'>
											<LlmProviderIcon
												provider={selectedModel.provider}
												baseUrl={selectedModel.baseUrl}
												className='size-4'
											/>
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
										<LlmProviderIcon
											provider={model.provider}
											baseUrl={model.baseUrl}
											className='size-4'
										/>
										{model.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					) : (
						selectedModel && (
							<div className='flex items-center gap-2 text-sm text-muted-foreground'>
								<LlmProviderIcon
									provider={selectedModel.provider}
									baseUrl={selectedModel.baseUrl}
									className='size-4'
								/>
								<span>{selectedModel.name}</span>
							</div>
						)
					)}
				</div>
			</SettingsCard>
		</div>
	);
}

function DiscordConnectionDetails({
	applicationId,
	publicKey,
	botTokenPreview,
	mentionRoleIds,
	respondToChannelIds,
}: {
	applicationId: string;
	publicKey: string;
	botTokenPreview: string;
	mentionRoleIds: string[];
	respondToChannelIds: string[];
}) {
	return (
		<div className='grid gap-1'>
			<span className='text-sm font-medium text-foreground'>Discord Bot</span>
			<span className='text-xs font-mono text-muted-foreground'>Application ID: {applicationId}</span>
			<span className='text-xs font-mono text-muted-foreground'>Public key: {publicKey}</span>
			<span className='text-xs font-mono text-muted-foreground'>Bot token: {botTokenPreview}</span>
			<span className='text-xs text-muted-foreground'>
				Trigger roles: {mentionRoleIds.length > 0 ? mentionRoleIds.join(', ') : 'Any'}
			</span>
			<span className='text-xs text-muted-foreground'>
				Respond to channels: {respondToChannelIds.length > 0 ? respondToChannelIds.join(', ') : 'All'}
			</span>
		</div>
	);
}

function parseIdList(value: string): string[] {
	return value
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean);
}
