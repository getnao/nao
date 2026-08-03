import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard } from '@/components/ui/settings-card';
import { trpc } from '@/main';

const AUTOMATIC_MODEL_VALUE = 'automatic';

interface SettingsLiveStoryRefreshProps {
	isAdmin: boolean;
}

export function SettingsLiveStoryRefresh({ isAdmin }: SettingsLiveStoryRefreshProps) {
	const queryClient = useQueryClient();
	const agentSettings = useQuery(trpc.project.getAgentSettings.queryOptions());
	const availableModels = useQuery(trpc.project.listAvailableTranscribeModels.queryOptions());
	const updateAgentSettings = useMutation(
		trpc.project.updateAgentSettings.mutationOptions({
			onSuccess: () => {
				void queryClient.invalidateQueries({
					queryKey: trpc.project.getAgentSettings.queryOptions().queryKey,
				});
			},
		}),
	);

	const configuredModel = agentSettings.data?.liveStoryRefresh;
	const selectedModel = availableModels.data?.find(
		(model) => model.provider === configuredModel?.provider && model.modelId === configuredModel.modelId,
	);
	const selectedValue = configuredModel
		? `${configuredModel.provider}:${configuredModel.modelId}`
		: AUTOMATIC_MODEL_VALUE;
	const selectedName = selectedModel?.name ?? configuredModel?.modelId;

	const handleModelChange = (value: string) => {
		if (value === AUTOMATIC_MODEL_VALUE) {
			updateAgentSettings.mutate({ liveStoryRefresh: null });
			return;
		}

		const model = availableModels.data?.find((candidate) => `${candidate.provider}:${candidate.modelId}` === value);
		if (!model) {
			return;
		}

		updateAgentSettings.mutate({
			liveStoryRefresh: {
				provider: model.provider,
				modelId: model.modelId,
			},
		});
	};

	return (
		<SettingsCard
			title='Live story refresh'
			description='Choose the model used to regenerate dynamic text when live stories refresh.'
		>
			<div className='grid gap-2'>
				<label htmlFor='live-story-refresh-model' className='text-sm font-medium text-foreground'>
					Default model
				</label>
				<Select
					value={selectedValue}
					onValueChange={handleModelChange}
					disabled={
						!isAdmin ||
						agentSettings.isLoading ||
						availableModels.isLoading ||
						updateAgentSettings.isPending
					}
				>
					<SelectTrigger id='live-story-refresh-model' className='w-full'>
						<SelectValue>
							<div className='flex min-w-0 items-center gap-2'>
								{configuredModel && (
									<LlmProviderIcon
										provider={configuredModel.provider}
										baseUrl={selectedModel?.baseUrl}
										className='size-4'
									/>
								)}
								<span className='truncate'>{selectedName ?? 'Automatic'}</span>
							</div>
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={AUTOMATIC_MODEL_VALUE}>Automatic</SelectItem>
						{availableModels.data?.map((model) => (
							<SelectItem
								key={`${model.provider}-${model.modelId}`}
								value={`${model.provider}:${model.modelId}`}
							>
								<LlmProviderIcon provider={model.provider} baseUrl={model.baseUrl} className='size-4' />
								{model.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p className='text-xs text-muted-foreground'>
					Automatic uses the default model from the project&apos;s configured provider.
				</p>
			</div>
		</SettingsCard>
	);
}
