import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { WhatsappForm } from './whatsapp-form';
import { Button } from '@/components/ui/button';
import { CopyableUrl } from '@/components/ui/copyable-url';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { SettingsCard } from '@/components/ui/settings-card';
import { trpc } from '@/main';

interface WhatsappConfigSectionProps {
	isAdmin: boolean;
}

export function WhatsappConfigSection({ isAdmin }: WhatsappConfigSectionProps) {
	const queryClient = useQueryClient();
	const whatsappConfig = useQuery(trpc.project.getWhatsappConfig.queryOptions());
	const { data: availableModels } = useQuery(trpc.project.getAvailableModels.queryOptions());

	const [isEditing, setIsEditing] = useState(false);
	type AvailableModel = NonNullable<typeof availableModels>[number];
	const [selectedModel, setSelectedModel] = useState<AvailableModel | null>(null);

	const projectConfig = whatsappConfig.data?.projectConfig;
	const webhookUrl = whatsappConfig.data?.webhookUrl;

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

	const upsertWhatsappConfig = useMutation(trpc.project.upsertWhatsappConfig.mutationOptions());
	const updateWhatsappModel = useMutation(trpc.project.updateWhatsappModelConfig.mutationOptions());
	const deleteWhatsappConfig = useMutation(trpc.project.deleteWhatsappConfig.mutationOptions());

	const handleSubmit = async (values: {
		accessToken: string;
		appSecret: string;
		phoneNumberId: string;
		verifyToken: string;
	}) => {
		await upsertWhatsappConfig.mutateAsync({
			...values,
			modelProvider: selectedModel?.provider,
			modelId: selectedModel?.modelId,
		});
		queryClient.invalidateQueries(trpc.project.getWhatsappConfig.queryOptions());
		setIsEditing(false);
	};

	const handleDelete = async () => {
		await deleteWhatsappConfig.mutateAsync();
		queryClient.removeQueries(trpc.project.getWhatsappConfig.queryOptions());
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
				await updateWhatsappModel.mutateAsync({ modelProvider: model.provider, modelId: model.modelId });
				queryClient.invalidateQueries(trpc.project.getWhatsappConfig.queryOptions());
			}
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[availableModels, queryClient],
	);

	if (!isAdmin) {
		return (
			<SettingsCard title='Connection' description='Your WhatsApp app credentials'>
				{projectConfig ? (
					<div className='grid gap-1'>
						<span className='text-sm font-medium text-foreground'>WhatsApp App</span>
						<span className='text-xs font-mono text-muted-foreground'>
							Access Token: {projectConfig.accessTokenPreview}
						</span>
						<span className='text-xs font-mono text-muted-foreground'>
							Phone Number ID: {projectConfig.phoneNumberIdPreview}
						</span>
					</div>
				) : (
					<p className='text-sm text-muted-foreground'>
						No WhatsApp integration configured. Contact an admin to set it up.
					</p>
				)}
			</SettingsCard>
		);
	}

	if (isEditing || !projectConfig) {
		return (
			<WhatsappForm
				hasProjectConfig={!!projectConfig}
				onSubmit={handleSubmit}
				onCancel={() => setIsEditing(false)}
				isPending={upsertWhatsappConfig.isPending}
			/>
		);
	}

	const hasMultipleModels = Boolean(availableModels && availableModels.length > 1);

	return (
		<div className='flex flex-col gap-6'>
			<SettingsCard title='Connection' description='Your WhatsApp app credentials'>
				<div className='flex items-center gap-4'>
					<div className='flex-1 grid gap-1'>
						<span className='text-sm font-medium text-foreground'>WhatsApp App</span>
						<span className='text-xs font-mono text-muted-foreground'>
							Access Token: {projectConfig.accessTokenPreview}
						</span>
						<span className='text-xs font-mono text-muted-foreground'>
							App Secret: {projectConfig.appSecretPreview}
						</span>
						<span className='text-xs font-mono text-muted-foreground'>
							Phone Number ID: {projectConfig.phoneNumberIdPreview}
						</span>
						<span className='text-xs font-mono text-muted-foreground'>
							Verify Token: {projectConfig.verifyTokenPreview}
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
							disabled={deleteWhatsappConfig.isPending}
						>
							<Trash2 className='size-4 text-destructive' />
						</Button>
					</div>
				</div>
			</SettingsCard>

			{webhookUrl && (
				<SettingsCard title='Webhook' description='Register this URL in your WhatsApp app settings'>
					<CopyableUrl url={webhookUrl} />
				</SettingsCard>
			)}

			<SettingsCard title='Settings' description='Configure how the WhatsApp bot behaves'>
				<div className='grid gap-2'>
					<label className='text-sm font-medium text-foreground'>Model</label>
					<p className='text-xs text-muted-foreground'>
						The model used to answer questions asked via WhatsApp.
					</p>
					{hasMultipleModels ? (
						<Select
							value={selectedModel ? `${selectedModel.provider}:${selectedModel.modelId}` : undefined}
							onValueChange={handleModelChange}
							disabled={updateWhatsappModel.isPending}
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
