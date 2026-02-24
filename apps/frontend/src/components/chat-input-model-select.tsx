import { useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { useAgentContext } from '@/contexts/agent.provider';
import { trpc } from '@/main';

export function ChatInputModelSelect() {
	const { selectedModel, setSelectedModel } = useAgentContext();
	const { data: knownModels } = useQuery(trpc.project.getKnownModels.queryOptions());
	const { data: availableModels } = useQuery(trpc.project.getAvailableModels.queryOptions());
	const hasMultipleModels = Boolean(availableModels && availableModels.length > 1);

	// Set default model when available models load, or reset if current selection is no longer available
	useEffect(() => {
		if (!availableModels || availableModels.length === 0) {
			return;
		}

		const isCurrentSelectionValid =
			selectedModel &&
			availableModels.some((m) => m.provider === selectedModel.provider && m.modelId === selectedModel.modelId);

		if (!isCurrentSelectionValid) {
			setSelectedModel(availableModels[0]);
		}
	}, [availableModels, selectedModel, setSelectedModel]);

	const handleModelValueChange = useCallback(
		(value: string) => {
			const model = availableModels?.find((m) => `${m.provider}:${m.modelId}` === value);
			if (model) {
				setSelectedModel(model);
			}
		},
		[availableModels, setSelectedModel],
	);

	const getModelDisplayName = (provider: string, modelId: string) => {
		const models = knownModels?.[provider as keyof typeof knownModels] ?? [];
		const model = models.find((m) => m.id === modelId);
		return model?.name ?? modelId;
	};

	if (!availableModels?.length) {
		return null;
	}

	if (!hasMultipleModels) {
		return (
			<div className='flex items-center gap-2 text-sm font-normal text-muted-foreground'>
				{selectedModel && <LlmProviderIcon provider={selectedModel.provider} className='size-4' />}
				<span>
					{selectedModel
						? getModelDisplayName(selectedModel.provider, selectedModel.modelId)
						: 'Select model'}
				</span>
			</div>
		);
	}

	return (
		<Select
			value={selectedModel ? `${selectedModel.provider}:${selectedModel.modelId}` : undefined}
			onValueChange={handleModelValueChange}
		>
			<SelectTrigger variant='ghost' className='p-0 gap-1 text-sm' size='sm'>
				<SelectValue>
					<div className='flex items-center gap-2'>
						{selectedModel && <LlmProviderIcon provider={selectedModel.provider} className='size-4' />}
						{selectedModel
							? getModelDisplayName(selectedModel.provider, selectedModel.modelId)
							: 'Select model'}
					</div>
				</SelectValue>
			</SelectTrigger>

			<SelectContent align='center' position='popper' side='top'>
				{availableModels.map((model) => (
					<SelectItem key={`${model.provider}-${model.modelId}`} value={`${model.provider}:${model.modelId}`}>
						<LlmProviderIcon provider={model.provider} className='size-4' />
						{getModelDisplayName(model.provider, model.modelId)}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
