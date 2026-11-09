import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { MattermostForm } from './mattermost-form';
import type { MattermostFormValues } from './mattermost-form';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { SettingsCard } from '@/components/ui/settings-card';
import { llmModelValue } from '@/lib/llm-model';
import { trpc } from '@/main';

interface MattermostConfigSectionProps {
	isAdmin: boolean;
	onCancelSetup: () => void;
}

export function MattermostConfigSection({ isAdmin, onCancelSetup }: MattermostConfigSectionProps) {
	const queryClient = useQueryClient();
	const mattermostConfig = useQuery(trpc.project.getMattermostConfig.queryOptions());
	const { data: availableModels } = useQuery(trpc.project.listAvailableTranscribeModels.queryOptions());

	const [isEditing, setIsEditing] = useState(false);
	type AvailableModel = NonNullable<typeof availableModels>[number];
	const [selectedModel, setSelectedModel] = useState<AvailableModel | null>(null);

	const projectConfig = mattermostConfig.data?.projectConfig;

	useEffect(() => {
		if (!availableModels || availableModels.length === 0) {
			return;
		}
		const persisted = projectConfig?.modelSelection;
		const match =
			persisted &&
			availableModels.find(
				(model) =>
					model.provider === persisted.provider &&
					model.modelId === persisted.modelId &&
					(!persisted.llmConfigId || model.llmConfigId === persisted.llmConfigId),
			);
		setSelectedModel(match || availableModels[0]);
	}, [availableModels, projectConfig]);

	const upsertMattermostConfig = useMutation(trpc.project.upsertMattermostConfig.mutationOptions());
	const updateMattermostModel = useMutation(trpc.project.updateMattermostModelConfig.mutationOptions());
	const deleteMattermostConfig = useMutation(trpc.project.deleteMattermostConfig.mutationOptions());

	const handleSubmit = async (values: MattermostFormValues) => {
		await upsertMattermostConfig.mutateAsync({
			...values,
			modelProvider: selectedModel?.provider,
			modelId: selectedModel?.modelId,
			llmConfigId: selectedModel?.llmConfigId,
		});
		queryClient.invalidateQueries(trpc.project.getMattermostConfig.queryOptions());
		setIsEditing(false);
	};

	const handleDelete = async () => {
		await deleteMattermostConfig.mutateAsync();
		queryClient.removeQueries(trpc.project.getMattermostConfig.queryOptions());
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
				(model) =>
					model.provider === persisted.provider &&
					model.modelId === persisted.modelId &&
					(!persisted.llmConfigId || model.llmConfigId === persisted.llmConfigId),
			);
		setSelectedModel(match || (availableModels?.[0] ?? null));
		setIsEditing(true);
	};

	const handleModelChange = async (value: string) => {
		const model = availableModels?.find((candidate) => llmModelValue(candidate) === value);
		if (!model) {
			return;
		}
		await updateMattermostModel.mutateAsync({
			modelProvider: model.provider,
			modelId: model.modelId,
			llmConfigId: model.llmConfigId,
		});
		setSelectedModel(model);
		queryClient.invalidateQueries(trpc.project.getMattermostConfig.queryOptions());
	};

	if (!isAdmin) {
		return (
			<SettingsCard title='Connection' description='Your Mattermost bot credentials'>
				{projectConfig ? (
					<MattermostConnectionDetails
						baseUrl={projectConfig.baseUrl}
						botTokenPreview={projectConfig.botTokenPreview}
						interactiveButtonsEnabled={projectConfig.interactiveButtonsEnabled}
					/>
				) : (
					<p className='text-sm text-muted-foreground'>
						No Mattermost integration configured. Contact an admin to set it up.
					</p>
				)}
			</SettingsCard>
		);
	}

	if (isEditing || !projectConfig) {
		return (
			<MattermostForm
				hasProjectConfig={Boolean(projectConfig)}
				initialBaseUrl={projectConfig?.baseUrl ?? ''}
				initialInteractiveButtonsEnabled={projectConfig?.interactiveButtonsEnabled ?? false}
				initialCallbackUrl={projectConfig?.callbackUrl ?? ''}
				onSubmit={handleSubmit}
				onCancel={handleCancel}
				isPending={upsertMattermostConfig.isPending}
			/>
		);
	}

	const hasMultipleModels = Boolean(availableModels && availableModels.length > 1);

	return (
		<div className='flex flex-col gap-6'>
			<SettingsCard title='Connection' description='Your Mattermost bot credentials'>
				<div className='flex items-center gap-4'>
					<div className='flex-1'>
						<MattermostConnectionDetails
							baseUrl={projectConfig.baseUrl}
							botTokenPreview={projectConfig.botTokenPreview}
							interactiveButtonsEnabled={projectConfig.interactiveButtonsEnabled}
						/>
					</div>
					<div className='flex gap-1'>
						<Button variant='ghost' size='icon-sm' onClick={handleStartEditing}>
							<Pencil className='size-3 text-muted-foreground' />
						</Button>
						<Button
							variant='ghost'
							size='icon-sm'
							onClick={handleDelete}
							disabled={deleteMattermostConfig.isPending}
						>
							<Trash2 className='size-4 text-destructive' />
						</Button>
					</div>
				</div>
			</SettingsCard>

			<SettingsCard title='Settings' description='Configure how the Mattermost bot behaves'>
				<div className='grid gap-2'>
					<label className='text-sm font-medium text-foreground'>Model</label>
					<p className='text-xs text-muted-foreground'>
						The model used to answer questions asked in Mattermost.
					</p>
					{hasMultipleModels ? (
						<Select
							value={selectedModel ? llmModelValue(selectedModel) : undefined}
							onValueChange={handleModelChange}
							disabled={updateMattermostModel.isPending}
						>
							<SelectTrigger className='w-full'>
								<SelectValue>
									{selectedModel && (
										<div className='flex items-center gap-2'>
											<LlmProviderIcon
												provider={selectedModel.provider}
												baseUrl={selectedModel.baseUrl}
												className='size-4'
											/>
											{selectedModel.name}
											{selectedModel.llmConfigName && (
												<span className='text-muted-foreground'>
													{selectedModel.llmConfigName}
												</span>
											)}
										</div>
									)}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								{availableModels?.map((model) => (
									<SelectItem key={llmModelValue(model)} value={llmModelValue(model)}>
										<LlmProviderIcon
											provider={model.provider}
											baseUrl={model.baseUrl}
											className='size-4'
										/>
										{model.name}
										{model.llmConfigName && (
											<span className='text-muted-foreground'>{model.llmConfigName}</span>
										)}
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
								{selectedModel.llmConfigName && <span>{selectedModel.llmConfigName}</span>}
							</div>
						)
					)}
				</div>
			</SettingsCard>
		</div>
	);
}

function MattermostConnectionDetails({
	baseUrl,
	botTokenPreview,
	interactiveButtonsEnabled,
}: {
	baseUrl: string;
	botTokenPreview: string;
	interactiveButtonsEnabled: boolean;
}) {
	return (
		<div className='grid gap-1'>
			<span className='text-sm font-medium text-foreground'>Mattermost Bot</span>
			<span className='text-xs font-mono text-muted-foreground'>Server URL: {baseUrl}</span>
			<span className='text-xs font-mono text-muted-foreground'>Bot Token: {botTokenPreview}</span>
			<span className='text-xs text-muted-foreground'>
				Interactive buttons: {interactiveButtonsEnabled ? 'Enabled' : 'Disabled'}
			</span>
		</div>
	);
}
