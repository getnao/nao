import type { LlmSelectedModel } from '@nao/shared/types';
import type { ModelMessage } from 'ai';

import { CACHE_1H, CACHE_5M } from '../agents/providers';

const BEDROCK_CACHE_1H = { type: 'default', ttl: '1h' } as const;
const BEDROCK_CACHE_5M = { type: 'default' } as const;

type AnthropicCache = typeof CACHE_1H | typeof CACHE_5M;
type BedrockCache = typeof BEDROCK_CACHE_1H | typeof BEDROCK_CACHE_5M;
type PromptCacheProvider = 'anthropic' | 'bedrock';

export function addPromptCache(messages: ModelMessage[], modelSelection: LlmSelectedModel): ModelMessage[] {
	const cacheProvider = getPromptCacheProvider(modelSelection);
	if (messages.length === 0 || !cacheProvider) {
		return messages;
	}

	const cachedMessages = [...messages];
	const lastIndex = cachedMessages.length - 1;
	if (cachedMessages[0].role === 'system') {
		cachedMessages[0] = withPromptCache(cachedMessages[0], cacheProvider, '1h');
	}
	if (cachedMessages.length > 1) {
		cachedMessages[lastIndex] = withPromptCache(cachedMessages[lastIndex], cacheProvider, '5m');
	}
	return cachedMessages;
}

export function getPromptCacheProvider(modelSelection: LlmSelectedModel): PromptCacheProvider | null {
	const { provider, modelId } = modelSelection;
	if (provider === 'anthropic') {
		return 'anthropic';
	}
	if (provider === 'vertex' && modelId.toLowerCase().startsWith('claude-')) {
		return 'anthropic';
	}
	if (provider === 'bedrock' && isBedrockAnthropicModel(modelId)) {
		return 'bedrock';
	}
	return null;
}

function withPromptCache(message: ModelMessage, provider: PromptCacheProvider, ttl: '1h' | '5m'): ModelMessage {
	return provider === 'bedrock'
		? withBedrockCache(message, ttl === '1h' ? BEDROCK_CACHE_1H : BEDROCK_CACHE_5M)
		: withAnthropicCache(message, ttl === '1h' ? CACHE_1H : CACHE_5M);
}

function withAnthropicCache(message: ModelMessage, cache: AnthropicCache): ModelMessage {
	return {
		...message,
		providerOptions: {
			...message.providerOptions,
			anthropic: { ...message.providerOptions?.anthropic, cacheControl: cache },
		},
	};
}

function withBedrockCache(message: ModelMessage, cache: BedrockCache): ModelMessage {
	return {
		...message,
		providerOptions: {
			...message.providerOptions,
			bedrock: { ...message.providerOptions?.bedrock, cachePoint: cache },
		},
	};
}

function isBedrockAnthropicModel(modelId: string): boolean {
	const normalized = modelId.toLowerCase();
	return normalized.includes('anthropic') || normalized.includes('claude');
}
