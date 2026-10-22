import type { LanguageModelV3 } from '@ai-sdk/provider';
import { type LanguageModelMiddleware, wrapLanguageModel } from 'ai';

/**
 * Replaces lone UTF-16 surrogates in the prompt with U+FFFD. They serialize to escapes like `\ude00` that strict
 * JSON parsers (LiteLLM's orjson) reject with a 400, and since the whole history is re-sent each turn, a single
 * half emoji in a stored message would otherwise break the chat for good.
 */
export function withWellFormedPrompt(model: LanguageModelV3): LanguageModelV3 {
	return wrapLanguageModel({ model, middleware: wellFormedPromptMiddleware });
}

const wellFormedPromptMiddleware: LanguageModelMiddleware = {
	specificationVersion: 'v3',
	transformParams: async ({ params }) => ({ ...params, prompt: toWellFormedDeep(params.prompt) }),
};

function toWellFormedDeep<T>(value: T): T {
	if (typeof value === 'string') {
		return value.toWellFormed() as T;
	}
	if (Array.isArray(value)) {
		return value.map(toWellFormedDeep) as T;
	}
	if (isPlainObject(value)) {
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toWellFormedDeep(entry)])) as T;
	}
	return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
