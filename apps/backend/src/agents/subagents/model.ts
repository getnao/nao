import type { LlmSelectedModel } from '@nao/shared/types';

import { getAvailableModelsForUser } from '../../services/user-group-llm-access.service';
import type { ToolContext } from '../../types/tools';
import { assertBudgetNotExceeded } from '../../utils/budget';
import { type ProjectAvailableModel, resolveAvailableModelSelection, resolveProviderModel } from '../../utils/llm';
import type { ProviderModelResult } from '../providers';

export interface SubagentModel {
	selection: LlmSelectedModel;
	config: ProviderModelResult;
}

type AvailableModel = ProjectAvailableModel;

/**
 * The model a subagent runs on, in order of precedence: a model the user explicitly asked for,
 * the one pinned in the project settings, then the model of the run that spawned it.
 */
export async function resolveSubagentModel(context: ToolContext, requestedModelId?: string): Promise<SubagentModel> {
	const selection = await resolveSelection(context, requestedModelId);
	await assertBudgetNotExceeded(context.projectId, selection.provider, context.userId);
	const config = await resolveProviderModel(
		context.projectId,
		selection.provider,
		selection.modelId,
		true,
		{
			userId: context.userId,
			projectId: context.projectId,
			chatId: context.chatId ?? undefined,
			runId: context.usageRunId,
			category: 'subagent',
			billingMode: context.managedAiBillingMode,
		},
		undefined,
		selection.llmConfigId,
	);
	if (!config) {
		throw new Error(`The model ${selection.modelId} (${selection.provider}) could not be resolved.`);
	}
	return { selection, config };
}

async function resolveSelection(context: ToolContext, requestedModelId?: string): Promise<LlmSelectedModel> {
	const available = await getAvailableModelsForUser(context.projectId, context.userId);

	if (requestedModelId) {
		return findRequestedModel(available, requestedModelId);
	}

	const pinned = context.agentSettings?.subagent?.model;
	if (pinned) {
		const resolved = resolveAvailableModelSelection(available, pinned);
		if (resolved) {
			return resolved;
		}
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
	return {
		provider: match.provider,
		modelId: match.modelId,
		...(match.llmConfigId && { llmConfigId: match.llmConfigId }),
	};
}
