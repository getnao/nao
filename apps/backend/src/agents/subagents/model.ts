import type { LlmSelectedModel } from '@nao/shared/types';

import type { ToolContext } from '../../types/tools';
import { assertBudgetNotExceeded } from '../../utils/budget';
import { getProjectAvailableModels, resolveProviderModel } from '../../utils/llm';
import type { ProviderModelResult } from '../providers';

export interface SubagentModel {
	selection: LlmSelectedModel;
	config: ProviderModelResult;
}

type AvailableModel = Awaited<ReturnType<typeof getProjectAvailableModels>>[number];

/**
 * The model a subagent runs on, in order of precedence: a model the user explicitly asked for,
 * the one pinned in the project settings, then the model of the run that spawned it.
 */
export async function resolveSubagentModel(context: ToolContext, requestedModelId?: string): Promise<SubagentModel> {
	const selection = await resolveSelection(context, requestedModelId);
	await assertBudgetNotExceeded(context.projectId, selection.provider, context.userId);
	const config = await resolveProviderModel(context.projectId, selection.provider, selection.modelId);
	if (!config) {
		throw new Error(`The model ${selection.modelId} (${selection.provider}) could not be resolved.`);
	}
	return { selection, config };
}

async function resolveSelection(context: ToolContext, requestedModelId?: string): Promise<LlmSelectedModel> {
	const available = await getProjectAvailableModels(context.projectId);

	if (requestedModelId) {
		return findRequestedModel(available, requestedModelId);
	}

	const pinned = context.agentSettings?.subagent?.model;
	if (pinned && available.some((model) => isSameModel(model, pinned))) {
		return pinned;
	}

	if (context.modelSelection) {
		return context.modelSelection;
	}

	const first = available.at(0);
	if (!first) {
		throw new Error('No model is configured for this project.');
	}
	return { provider: first.provider, modelId: first.modelId };
}

function findRequestedModel(available: AvailableModel[], requestedModelId: string): LlmSelectedModel {
	const requested = requestedModelId.trim().toLowerCase();
	const match = available.find(
		(model) => model.modelId.toLowerCase() === requested || model.name.toLowerCase() === requested,
	);
	if (!match) {
		const names = available.map((model) => model.modelId).join(', ');
		throw new Error(
			`Unknown model '${requestedModelId}'. Available models: ${names}. Omit model_id to use the default subagent model.`,
		);
	}
	return { provider: match.provider, modelId: match.modelId };
}

function isSameModel(left: LlmSelectedModel, right: LlmSelectedModel): boolean {
	return left.provider === right.provider && left.modelId === right.modelId;
}
