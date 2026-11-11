import {
	STORY_LLM_DEFAULT_OUTPUT_TOKENS,
	STORY_LLM_MAX_OUTPUT_TOKENS,
	type StoryLlmRequest,
	type StoryLlmResult,
	type StoryModel,
	type StoryModelRequest,
	type StoryModelResult,
	toStoryModelId,
} from '@nao/shared/story-models';
import { isSameModel } from '@nao/shared/types';
import { generateText, jsonSchema, Output } from 'ai';

import { llmTelemetry } from '../agents/telemetry';
import { convertToTokenUsage } from '../utils/ai';
import { getProjectAvailableModels, resolveDefaultChatModel, resolveProviderModel } from '../utils/llm';
import { scheduleSaveLlmInferenceRecord } from '../utils/schedule-task';
import { agentService } from './agent';

export interface CustomStoryModelTarget {
	projectId: string;
	chatId: string | null;
	/** The user looking at the story: the call runs under their budget and is billed to them. */
	viewerId: string;
}

/** A model call that cannot run is the story's content, like a failing query: its reason reaches the frame. */
export class CustomStoryModelError extends Error {}

/** The models a story can call in this project: the LLMs its chat offers, with the default chat model marked. */
export async function listCustomStoryModels(projectId: string): Promise<StoryModel[]> {
	const [available, defaultModel] = await Promise.all([
		getProjectAvailableModels(projectId),
		resolveDefaultChatModel(projectId),
	]);
	return available.map((model) => ({
		kind: 'llm',
		id: toStoryModelId(model),
		provider: model.provider,
		modelId: model.modelId,
		name: model.name,
		isDefault: defaultModel !== null && isSameModel(model, defaultModel),
	}));
}

export async function runCustomStoryModel(
	target: CustomStoryModelTarget,
	request: StoryModelRequest,
): Promise<StoryModelResult> {
	switch (request.kind) {
		case 'llm':
			return runStoryLlm(target, request);
	}
}

async function runStoryLlm(target: CustomStoryModelTarget, request: StoryLlmRequest): Promise<StoryLlmResult> {
	const model = await findRequestedLlm(target.projectId, request.model);
	try {
		const selection = await agentService.assertRunAvailable(target.projectId, model, target.viewerId);
		const providerModel = await resolveProviderModel(
			target.projectId,
			selection.provider,
			selection.modelId,
			true,
			{
				userId: target.viewerId,
				projectId: target.projectId,
				...(target.chatId && { chatId: target.chatId }),
				category: 'story',
			},
		);
		if (!providerModel) {
			throw new CustomStoryModelError(`Model ${toStoryModelId(selection)} is not available.`);
		}

		const generated = await generateText({
			...providerModel,
			...(request.system && { system: request.system }),
			messages: [{ role: 'user', content: request.prompt }],
			maxOutputTokens: Math.min(
				request.maxOutputTokens ?? STORY_LLM_DEFAULT_OUTPUT_TOKENS,
				STORY_LLM_MAX_OUTPUT_TOKENS,
			),
			...(request.schema && { output: Output.object({ schema: jsonSchema(request.schema) }) }),
			experimental_telemetry: llmTelemetry('nao-custom-story-model', {
				projectId: target.projectId,
				tags: [selection.provider],
			}),
		});

		scheduleSaveLlmInferenceRecord({
			type: 'custom_story_model',
			projectId: target.projectId,
			userId: target.viewerId,
			chatId: target.chatId,
			llmProvider: selection.provider,
			llmModelId: selection.modelId,
			...convertToTokenUsage(generated.usage),
		});

		return {
			kind: 'llm',
			model: toStoryModelId(selection),
			text: generated.text,
			...(request.schema && { object: generated.output }),
		};
	} catch (error) {
		throw error instanceof CustomStoryModelError
			? error
			: new CustomStoryModelError(error instanceof Error ? error.message : String(error));
	}
}

/** Only models the project offers can be called: a story cannot reach a provider or model the chat does not list. */
async function findRequestedLlm(projectId: string, modelId: string | undefined) {
	if (modelId === undefined) {
		return undefined;
	}
	const model = (await getProjectAvailableModels(projectId)).find(
		(candidate) => toStoryModelId(candidate) === modelId,
	);
	if (!model) {
		throw new CustomStoryModelError(
			`Model ${modelId} is not available in this project. List them with useModels().`,
		);
	}
	return { provider: model.provider, modelId: model.modelId };
}
