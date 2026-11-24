import type { BackgroundModelCategory } from '@nao/shared';
import type { LlmSelectedModel } from '@nao/shared/types';

import type { ManagedAiUsageContext } from '../agents/managed-ai';
import type { ProviderModelResult } from '../agents/providers';
import { HandlerError } from '../utils/error';
import { resolveDefaultModelSelection, resolveProviderModel } from '../utils/llm';
import { resolveUserBackgroundModelId, resolveUserBackgroundModelSelection } from './user-group-llm-access.service';

export interface BackgroundModelRequest {
	projectId: string;
	userId: string;
	/** Pinned default model that wins over everything else. */
	defaultCategory?: BackgroundModelCategory;
	/** Used when nothing is pinned; the user's default chat model when absent. */
	fallback?: LlmSelectedModel | null;
	/** Cheaper model to run on the selected credential when nothing is pinned. */
	preferredModelId?: (selection: LlmSelectedModel) => string | Promise<string>;
	usageContext: ManagedAiUsageContext;
	applyUserSettings?: boolean;
}

export interface BackgroundModel extends LlmSelectedModel {
	model: ProviderModelResult;
}

/**
 * The model for work the user did not pick a model for (titles, memory, compaction, …), kept within
 * the user's group grants. Null when the user has no model to run it on.
 */
export async function resolveUserBackgroundModel(request: BackgroundModelRequest): Promise<BackgroundModel | null> {
	const { projectId, userId } = request;
	const pinned = request.defaultCategory
		? await resolveDefaultModelSelection(projectId, request.defaultCategory)
		: null;
	const selection = await selectGrantedModel(projectId, userId, pinned ?? request.fallback);
	if (!selection) {
		return null;
	}

	const modelId = await resolveModelId(request, selection, !!pinned);
	const model = await resolveProviderModel(
		projectId,
		selection.provider,
		modelId,
		request.applyUserSettings ?? false,
		request.usageContext,
		undefined,
		selection.llmConfigId,
	);
	return model ? { ...selection, modelId, model } : null;
}

async function selectGrantedModel(
	projectId: string,
	userId: string,
	requested: LlmSelectedModel | null | undefined,
): Promise<LlmSelectedModel | null> {
	try {
		return await resolveUserBackgroundModelSelection(projectId, userId, requested);
	} catch (error) {
		if (error instanceof HandlerError) {
			return null;
		}
		throw error;
	}
}

async function resolveModelId(
	request: BackgroundModelRequest,
	selection: LlmSelectedModel,
	isPinned: boolean,
): Promise<string> {
	if (isPinned || !request.preferredModelId) {
		return selection.modelId;
	}
	const preferredModelId = await request.preferredModelId(selection);
	if (preferredModelId === selection.modelId) {
		return preferredModelId;
	}
	return resolveUserBackgroundModelId(request.projectId, request.userId, selection, preferredModelId);
}
