import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';

import type { LlmProvider } from '../../types/llm';
import type { ProviderSettings } from '../providers';

type WebSearchToolCreator = (settings: ProviderSettings) => unknown;

const WEB_SEARCH_CREATORS: Partial<Record<LlmProvider, WebSearchToolCreator>> = {
	openai: (settings) => createOpenAI(settings).tools.webSearch({ searchContextSize: 'medium' }),
	anthropic: (settings) => createAnthropic(settings).tools.webSearch_20250305({ maxUses: 5 }),
};

export const WEB_SEARCH_PROVIDERS = new Set(Object.keys(WEB_SEARCH_CREATORS) as LlmProvider[]);

export function createWebSearchTool(provider: LlmProvider, settings: ProviderSettings): unknown | null {
	const creator = WEB_SEARCH_CREATORS[provider];
	if (!creator) {
		return null;
	}
	return creator(settings);
}
