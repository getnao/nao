import type { LlmProvider } from './types';

/** Every kind of model a custom story can call. Each kind brings its own request and result shapes. */
export const STORY_MODEL_KINDS = ['llm'] as const;

export type StoryModelKind = (typeof STORY_MODEL_KINDS)[number];

export interface StoryLlmModel {
	kind: 'llm';
	/** What a story passes back in `model` to pick this one. */
	id: string;
	provider: LlmProvider;
	modelId: string;
	name: string;
	/** The project's default chat model, used when a request names no model. */
	isDefault: boolean;
}

export type StoryModel = StoryLlmModel;

export interface StoryLlmRequest {
	kind: 'llm';
	/** A `StoryModel['id']` from `useModels()`; the project's default chat model when left out. */
	model?: string;
	prompt: string;
	system?: string;
	/** A JSON Schema: the model then answers with an object of that shape, in `object`. */
	schema?: Record<string, unknown>;
	maxOutputTokens?: number;
}

export type StoryModelRequest = StoryLlmRequest;

export interface StoryLlmResult {
	kind: 'llm';
	model: string;
	text: string;
	object?: unknown;
}

export type StoryModelResult = StoryLlmResult;

export const STORY_LLM_DEFAULT_OUTPUT_TOKENS = 1_024;
export const STORY_LLM_MAX_OUTPUT_TOKENS = 4_096;

export function toStoryModelId(model: { provider: LlmProvider; modelId: string }): string {
	return `${model.provider}:${model.modelId}`;
}
