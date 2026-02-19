import type { LlmProvider } from '@nao/backend/llm';

export interface ChatSelectedModel {
	provider: LlmProvider;
	modelId: string;
}
