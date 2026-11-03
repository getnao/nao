import type { LlmSelectedModel } from '@nao/shared/types';
import type { ModelMessage, SystemModelMessage, UserModelMessage } from 'ai';

import { CACHE_1H, CACHE_5M } from '../agents/providers';
import { CHAT_ARTIFACTS_TAG } from '../components/ai/chat-artifacts-prompt';

const BEDROCK_CACHE_1H = { type: 'default', ttl: '1h' } as const;
const BEDROCK_CACHE_5M = { type: 'default' } as const;

type AnthropicCache = typeof CACHE_1H | typeof CACHE_5M;
type BedrockCache = typeof BEDROCK_CACHE_1H | typeof BEDROCK_CACHE_5M;
type PromptCacheProvider = 'anthropic' | 'bedrock';
type CacheTarget = Pick<ModelMessage, 'providerOptions'>;

export function cachedSystemInstructions(text: string, modelSelection: LlmSelectedModel): string | SystemModelMessage {
	const cacheProvider = getPromptCacheProvider(modelSelection);
	if (!cacheProvider) {
		return text;
	}

	return withPromptCache<SystemModelMessage>({ role: 'system', content: text }, cacheProvider, '1h');
}

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
	return withCrossTurnBreakpoints(cachedMessages, cacheProvider);
}

export function getPromptCacheProvider(modelSelection: LlmSelectedModel): PromptCacheProvider | null {
	const { provider, modelId } = modelSelection;
	if (provider === 'anthropic') {
		return 'anthropic';
	}
	if (provider === 'vertex' && modelId.toLowerCase().startsWith('claude-')) {
		return 'anthropic';
	}
	if (provider === 'openrouter' && modelId.toLowerCase().startsWith('anthropic/')) {
		return 'anthropic';
	}
	if (provider === 'bedrock' && isBedrockAnthropicModel(modelId)) {
		return 'bedrock';
	}
	return null;
}

/**
 * The artifacts block moves to the last user message every turn: cache the part just before it, and
 * the previous user message so the next turn still finds that entry after a long tool loop.
 */
function withCrossTurnBreakpoints(messages: ModelMessage[], provider: PromptCacheProvider): ModelMessage[] {
	const userIndices = messages.flatMap((message, index) => (message.role === 'user' ? [index] : []));
	const lastUserIndex = userIndices.at(-1);
	const previousUserIndex = userIndices.at(-2);
	if (lastUserIndex === undefined) {
		return messages;
	}
	const cachedMessages = [...messages];
	cachedMessages[lastUserIndex] = withBreakpointBeforeArtifacts(
		cachedMessages[lastUserIndex] as UserModelMessage,
		provider,
	);
	if (previousUserIndex !== undefined) {
		cachedMessages[previousUserIndex] = withPromptCache(cachedMessages[previousUserIndex], provider, '5m');
	}
	return cachedMessages;
}

function withBreakpointBeforeArtifacts(message: UserModelMessage, provider: PromptCacheProvider): UserModelMessage {
	if (typeof message.content === 'string') {
		return message;
	}
	const artifactsIndex = message.content
		.map((part) => part.type === 'text' && part.text.startsWith(`<${CHAT_ARTIFACTS_TAG}>`))
		.lastIndexOf(true);
	if (artifactsIndex < 1) {
		return message;
	}
	const content = [...message.content];
	content[artifactsIndex - 1] = withPromptCache(content[artifactsIndex - 1], provider, '5m');
	return { ...message, content };
}

function withPromptCache<T extends CacheTarget>(target: T, provider: PromptCacheProvider, ttl: '1h' | '5m'): T {
	return provider === 'bedrock'
		? withBedrockCache(target, ttl === '1h' ? BEDROCK_CACHE_1H : BEDROCK_CACHE_5M)
		: withAnthropicCache(target, ttl === '1h' ? CACHE_1H : CACHE_5M);
}

function withAnthropicCache<T extends CacheTarget>(target: T, cache: AnthropicCache): T {
	return {
		...target,
		providerOptions: {
			...target.providerOptions,
			anthropic: { ...target.providerOptions?.anthropic, cacheControl: cache },
		},
	};
}

function withBedrockCache<T extends CacheTarget>(target: T, cache: BedrockCache): T {
	return {
		...target,
		providerOptions: {
			...target.providerOptions,
			bedrock: { ...target.providerOptions?.bedrock, cachePoint: cache },
		},
	};
}

function isBedrockAnthropicModel(modelId: string): boolean {
	const normalized = modelId.toLowerCase();
	return normalized.includes('anthropic') || normalized.includes('claude');
}
