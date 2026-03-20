import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { TelegramForm } from './telegram-form';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { SettingsCard } from '@/components/ui/settings-card';
import { trpc } from '@/main';

interface TelegramConfigSectionProps {
	isAdmin: boolean;
}

export function TelegramConfigSection({ isAdmin }: TelegramConfigSectionProps) {
	const queryClient = useQueryClient();
	const telegramConfig = useQuery(trpc.project.getTelegramConfig.queryOptions());
	const { data: availableModels } = useQuery(trpc.project.getAvailableModels.queryOptions());

	const [isEditing, setIsEditing] = useState(false);
	type AvailableModel = NonNullable<typeof availableModels>[number];
	const [selectedModel, setSelectedModel] = useState<AvailableModel | null>(null);

	const projectConfig = telegramConfig.data?.projectConfig;
	const webhookUrl = telegramConfig.data?.webhookUrl ?? '';

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

	const upsertTelegramConfig = useMutation(trpc.project.upsertTelegramConfig.mutationOptions());
	const updateTelegramModel = useMutation(trpc.project.updateTelegramModelConfig.mutationOptions());
	const deleteTelegramConfig = useMutation(trpc.project.deleteTelegramConfig.mutationOptions());

	const handleSubmit = async (values: { botToken: string }) => {
		await upsertTelegramConfig.mutateAsync({
			botToken: values.botToken,
			modelProvider: selectedModel?.provider,
			modelId: selectedModel?.modelId,
		});

		const webhookResponse = await fetch(`https://api.telegram.org/bot${values.botToken}/setWebhook`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				url: webhookUrl,
			}),
		});
		const webhookResult = await webhookResponse.json();
		if (!webhookResult.ok) {
			throw new Error(webhookResult.description ?? 'Failed to set Telegram webhook');
		}

		queryClient.invalidateQueries(trpc.project.getTelegramConfig.queryOptions());
		setIsEditing(false);
	};

	const handleDelete = async () => {
		await deleteTelegramConfig.mutateAsync();
		queryClient.removeQueries(trpc.project.getTelegramConfig.queryOptions());
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
				await updateTelegramModel.mutateAsync({ modelProvider: model.provider, modelId: model.modelId });
				setSelectedModel(model);
				queryClient.invalidateQueries(trpc.project.getTelegramConfig.queryOptions());
			}
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[availableModels, queryClient],
	);

	if (!isAdmin) {
		return (
			<SettingsCard title='Connection' description='Your Telegram bot credentials'>
				{projectConfig ? (
					<div className='grid gap-1'>
						<span className='text-sm font-medium text-foreground'>Telegram Bot</span>
						<span className='text-xs font-mono text-muted-foreground'>
							Bot Token: {projectConfig.botTokenPreview}
						</span>
					</div>
				) : (
					<p className='text-sm text-muted-foreground'>
						No Telegram integration configured. Contact an admin to set it up.
					</p>
				)}
			</SettingsCard>
		);
	}

	if (isEditing || !projectConfig) {
		return (
			<TelegramForm
				hasProjectConfig={!!projectConfig}
				onSubmit={handleSubmit}
				onCancel={() => setIsEditing(false)}
				isPending={upsertTelegramConfig.isPending}
				webhookUrl={webhookUrl}
			/>
		);
	}

	const hasMultipleModels = Boolean(availableModels && availableModels.length > 1);

	return (
		<div className='flex flex-col gap-6'>
			<SettingsCard title='Connection' description='Your Telegram bot credentials'>
				<div className='flex items-center gap-4'>
					<div className='flex-1 grid gap-1'>
						<span className='text-sm font-medium text-foreground'>Telegram Bot</span>
						<span className='text-xs font-mono text-muted-foreground'>
							Bot Token: {projectConfig.botTokenPreview}
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
							disabled={deleteTelegramConfig.isPending}
						>
							<Trash2 className='size-4 text-destructive' />
						</Button>
					</div>
				</div>
			</SettingsCard>

			<SettingsCard title='Settings' description='Configure how the Telegram bot behaves'>
				<div className='grid gap-2'>
					<label className='text-sm font-medium text-foreground'>Model</label>
					<p className='text-xs text-muted-foreground'>
						The model used to answer questions asked in Telegram.
					</p>
					{hasMultipleModels ? (
						<Select
							value={selectedModel ? `${selectedModel.provider}:${selectedModel.modelId}` : undefined}
							onValueChange={handleModelChange}
							disabled={updateTelegramModel.isPending}
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
