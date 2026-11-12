import type { LlmSelectedModel } from '@nao/shared/types';

export interface LlmModelOption extends LlmSelectedModel {
	llmConfigName?: string;
}

export function llmModelValue(model: LlmSelectedModel): string {
	return JSON.stringify([model.provider, model.modelId, model.llmConfigId ?? null]);
}

export function toLlmSelectedModel(model: LlmSelectedModel): LlmSelectedModel {
	return {
		provider: model.provider,
		modelId: model.modelId,
		...(model.llmConfigId && { llmConfigId: model.llmConfigId }),
	};
}
