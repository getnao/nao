import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';

import type { LlmProvider, ProviderSettings } from '../../types/llm';

type ProviderToolCreator = (settings: ProviderSettings) => unknown;

const WEB_SEARCH_CREATORS: Partial<Record<LlmProvider, ProviderToolCreator>> = {
	openai: (settings) => createOpenAI(settings).tools.webSearch({ searchContextSize: 'medium' }),
	anthropic: (settings) => createAnthropic(settings).tools.webSearch_20250305({ maxUses: 5 }),
	google: (settings) => createGoogleGenerativeAI(settings).tools.googleSearch({}),
};

const WEB_FETCH_CREATORS: Partial<Record<LlmProvider, ProviderToolCreator>> = {
	anthropic: (settings) => createAnthropic(settings).tools.webFetch_20250910({ maxUses: 3 }),
};

export const WEB_SEARCH_PROVIDERS = new Set(Object.keys(WEB_SEARCH_CREATORS) as LlmProvider[]);

export function createWebSearchTools(
	provider: LlmProvider,
	settings: ProviderSettings,
): Record<string, unknown> | null {
	const searchCreator = WEB_SEARCH_CREATORS[provider];
	if (!searchCreator) {
		return null;
	}

	const tools: Record<string, unknown> = {
		web_search: searchCreator(settings),
	};

	const fetchCreator = WEB_FETCH_CREATORS[provider];
	if (fetchCreator) {
		tools.web_fetch = fetchCreator(settings);
	}

	return tools;
}
