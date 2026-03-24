import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { TeamsForm } from './teams-form';
import { Button } from '@/components/ui/button';
import { CopyableUrl } from '@/components/ui/copyable-url';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { SettingsCard } from '@/components/ui/settings-card';
import { trpc } from '@/main';

interface TeamsConfigSectionProps {
	isAdmin: boolean;
}

export function TeamsConfigSection({ isAdmin }: TeamsConfigSectionProps) {
	const queryClient = useQueryClient();
	const teamsConfig = useQuery(trpc.project.getTeamsConfig.queryOptions());
	const { data: availableModels } = useQuery(trpc.project.getAvailableModels.queryOptions());

	const [isEditing, setIsEditing] = useState(false);
	type AvailableModel = NonNullable<typeof availableModels>[number];
	const [selectedModel, setSelectedModel] = useState<AvailableModel | null>(null);

	const projectConfig = teamsConfig.data?.projectConfig;
	const webhookUrl = teamsConfig.data?.webhookUrl ?? '';

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

	const upsertTeamsConfig = useMutation(trpc.project.upsertTeamsConfig.mutationOptions());
	const updateTeamsModel = useMutation(trpc.project.updateTeamsModelConfig.mutationOptions());
	const deleteTeamsConfig = useMutation(trpc.project.deleteTeamsConfig.mutationOptions());

	const handleSubmit = async (values: { appId: string; appPassword: string; tenantId: string }) => {
		await upsertTeamsConfig.mutateAsync({
			...values,
			modelProvider: selectedModel?.provider,
			modelId: selectedModel?.modelId,
		});
		queryClient.invalidateQueries(trpc.project.getTeamsConfig.queryOptions());
		setIsEditing(false);
	};

	const handleDelete = async () => {
		await deleteTeamsConfig.mutateAsync();
		queryClient.removeQueries(trpc.project.getTeamsConfig.queryOptions());
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
				await updateTeamsModel.mutateAsync({ modelProvider: model.provider, modelId: model.modelId });
				setSelectedModel(model);
				queryClient.invalidateQueries(trpc.project.getTeamsConfig.queryOptions());
			}
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[availableModels, queryClient],
	);

	if (!isAdmin) {
		return (
			<SettingsCard title='Connection' description='Your Teams app credentials'>
				{projectConfig ? (
					<div className='grid gap-1'>
						<span className='text-sm font-medium text-foreground'>Teams App</span>
						<span className='text-xs font-mono text-muted-foreground'>
							App ID: {projectConfig.appIdPreview}
						</span>
						<span className='text-xs font-mono text-muted-foreground'>
							App Password: {projectConfig.appPasswordPreview}
						</span>
						<span className='text-xs font-mono text-muted-foreground'>
							Tenant ID: {projectConfig.tenantIdPreview}
						</span>
					</div>
				) : (
					<p className='text-sm text-muted-foreground'>
						No Teams integration configured. Contact an admin to set it up.
					</p>
				)}
			</SettingsCard>
		);
	}

	if (isEditing || !projectConfig) {
		return (
			<TeamsForm
				hasProjectConfig={!!projectConfig}
				onSubmit={handleSubmit}
				onCancel={() => setIsEditing(false)}
				isPending={upsertTeamsConfig.isPending}
				teamsRedirectUrl={teamsConfig.data?.redirectUrl}
			/>
		);
	}

	const hasMultipleModels = Boolean(availableModels && availableModels.length > 1);

	return (
		<div className='flex flex-col gap-6'>
			<SettingsCard title='Connection' description='Your Teams app credentials'>
				<div className='flex items-center gap-4'>
					<div className='flex-1 grid gap-1'>
						<span className='text-sm font-medium text-foreground'>Teams App</span>
						<span className='text-xs font-mono text-muted-foreground'>
							App ID: {projectConfig.appIdPreview}
						</span>
						<span className='text-xs font-mono text-muted-foreground'>
							App Password: {projectConfig.appPasswordPreview}
						</span>
						<span className='text-xs font-mono text-muted-foreground'>
							Tenant ID: {projectConfig.tenantIdPreview}
						</span>
					</div>
					<div className='flex gap-1'>
						<Button variant='ghost' size='icon-sm' onClick={handleStartEditing}>
							<Pencil className='size-3 text-muted-foreground' />
						</Button>
						<Button
							variant='ghost'
							size='icon-sm'
							onClick={handleDelete}
							disabled={deleteTeamsConfig.isPending}
						>
							<Trash2 className='size-4 text-destructive' />
						</Button>
					</div>
				</div>
			</SettingsCard>

			{webhookUrl && (
				<SettingsCard title='Messaging Endpoint' description='Register this URL in your Azure bot settings'>
					<CopyableUrl url={webhookUrl} />
				</SettingsCard>
			)}

			<SettingsCard title='Settings' description='Configure how the Teams bot behaves'>
				<div className='grid gap-2'>
					<label className='text-sm font-medium text-foreground'>Model</label>
					<p className='text-xs text-muted-foreground'>The model used to answer questions asked in Teams.</p>
					{hasMultipleModels ? (
						<Select
							value={selectedModel ? `${selectedModel.provider}:${selectedModel.modelId}` : undefined}
							onValueChange={handleModelChange}
							disabled={updateTeamsModel.isPending}
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
			</SettingsCard>
		</div>
	);
}
