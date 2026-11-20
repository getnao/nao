import type { LlmSelectedModel } from '@nao/shared/types';

export interface LlmModelOption extends LlmSelectedModel {
	llmConfigName?: string;
}

export function llmModelValue(model: LlmSelectedModel): string {
	return JSON.stringify([model.provider, model.modelId, model.llmConfigId ?? null]);
}

/** Selections saved before credentials were named have no `llmConfigId` and match the first credential serving their model. */
export function findAvailableModel<T extends LlmSelectedModel>(
	availableModels: readonly T[] | undefined,
	selection: LlmSelectedModel,
): T | undefined {
	return availableModels?.find(
		(model) =>
			model.provider === selection.provider &&
			model.modelId === selection.modelId &&
			(!selection.llmConfigId || model.llmConfigId === selection.llmConfigId),
	);
}

export function toLlmSelectedModel(model: LlmSelectedModel): LlmSelectedModel {
	return {
		provider: model.provider,
		modelId: model.modelId,
		...(model.llmConfigId && { llmConfigId: model.llmConfigId }),
	};
}
