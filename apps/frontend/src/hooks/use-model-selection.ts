import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { LlmSelectedModel } from '@nao/shared/types';
import { useAgentContext } from '@/contexts/agent.provider';
import { trpc } from '@/main';

export function useModelSelection() {
	const { selectedModel, usesDefaultModel, setSelectedModel } = useAgentContext();
	const currentProjectQuery = useQuery(trpc.project.getCurrent.queryOptions());
	const hasProject = currentProjectQuery.isError || currentProjectQuery.data != null;
	const availableModelsQuery = useQuery({
		...trpc.project.listAvailableTranscribeModels.queryOptions(),
		enabled: hasProject,
	});
	const defaultModelQuery = useQuery({
		...trpc.project.getDefaultChatModel.queryOptions(),
		enabled: hasProject,
	});
	const availableModels = hasProject ? availableModelsQuery.data : undefined;
	const isPending = currentProjectQuery.isPending || (hasProject && availableModelsQuery.isPending);
	const canCycleModels = (availableModels?.length ?? 0) > 1;

	/** Cycles through "nao default" followed by every available model. */
	const cycleModel = useCallback(() => {
		if (!availableModels || availableModels.length < 2) {
			return;
		}
		if (usesDefaultModel) {
			setSelectedModel(availableModels[0]);
			return;
		}
		const currentIndex = availableModels.findIndex((model) => isSameModel(model, selectedModel));
		const nextModel = availableModels[currentIndex + 1] ?? null;
		setSelectedModel(nextModel);
	}, [availableModels, usesDefaultModel, selectedModel, setSelectedModel]);

	return {
		availableModels,
		defaultModel: hasProject ? (defaultModelQuery.data ?? null) : null,
		selectedModel,
		usesDefaultModel,
		setSelectedModel,
		isPending,
		canCycleModels,
		cycleModel,
		hasProject,
	};
}

export function isSameModel(model: LlmSelectedModel, other: LlmSelectedModel | null): boolean {
	return !!other && model.provider === other.provider && model.modelId === other.modelId;
}
