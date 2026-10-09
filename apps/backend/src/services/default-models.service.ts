import type { BackgroundModelCategory } from '@nao/shared';
import type { LlmProvider, LlmSelectedModel } from '@nao/shared/types';

import { getProviderMeta } from '../agents/providers';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import * as mattermostConfigQueries from '../queries/project-mattermost-config.queries';
import * as slackConfigQueries from '../queries/project-slack-config.queries';
import * as teamsConfigQueries from '../queries/project-teams-config.queries';
import * as telegramConfigQueries from '../queries/project-telegram-config.queries';
import * as whatsappConfigQueries from '../queries/project-whatsapp-config.queries';
import {
	getDefaultModelId,
	getProjectAvailableModels,
	getProjectModelNameResolver,
	resolveAnnotationModelId,
	resolveDefaultChatModel,
} from '../utils/llm';
import { mattermostService } from './mattermost';
import { slackService } from './slack';

export const MODEL_INTEGRATIONS = ['slack', 'teams', 'telegram', 'whatsapp', 'mattermost'] as const;

export type ModelIntegration = (typeof MODEL_INTEGRATIONS)[number];

export interface ResolvedDefaultModel extends LlmSelectedModel {
	name: string;
}

export interface BuiltInDefaultModels {
	chat: ResolvedDefaultModel | null;
	categories: Partial<Record<BackgroundModelCategory, ResolvedDefaultModel>>;
}

export interface IntegrationModel {
	integration: ModelIntegration;
	modelSelection: LlmSelectedModel | null;
}

/**
 * The model behind every "nao default" today. Tasks tied to a conversation (titles, compaction,
 * memory) derive their model from the conversation's one, so they are resolved against the chat default.
 */
export async function resolveBuiltInDefaultModels(projectId: string): Promise<BuiltInDefaultModels> {
	const [chat, available] = await Promise.all([
		resolveDefaultChatModel(projectId),
		getProjectAvailableModels(projectId),
	]);
	const firstAvailable = available.at(0);
	if (!chat || !firstAvailable) {
		return { chat: null, categories: {} };
	}

	const [nameOf, taskProvider] = await Promise.all([
		getProjectModelNameResolver(projectId),
		llmConfigQueries.getProjectModelProvider(projectId),
	]);
	const named = (selection: LlmSelectedModel): ResolvedDefaultModel => ({
		...selection,
		name: nameOf(selection.provider, selection.modelId),
	});
	const annotationModel = async (fallbackModelId: string): Promise<LlmSelectedModel> => ({
		provider: chat.provider,
		modelId: await resolveAnnotationModelId(projectId, chat, fallbackModelId),
	});
	const { summaryModelId, extractorModelId } = getProviderMeta(chat.provider);
	const [title, extractor] = await Promise.all([annotationModel(summaryModelId), annotationModel(extractorModelId)]);

	return {
		chat: named({ provider: firstAvailable.provider, modelId: firstAvailable.modelId }),
		categories: {
			...(taskProvider && { live_story: named(defaultModelOf(taskProvider)) }),
			title: named(title),
			compaction: named(extractor),
			context_recommendation: named(chat),
			other: named(extractor),
		},
	};
}

/** The model each configured messaging integration answers with; null means it follows the chat default. */
export async function listIntegrationModels(projectId: string): Promise<IntegrationModel[]> {
	const [slack, teams, telegram, whatsapp, mattermost] = await Promise.all([
		slackConfigQueries.getProjectSlackConfig(projectId),
		teamsConfigQueries.getProjectTeamsConfig(projectId),
		telegramConfigQueries.getProjectTelegramConfig(projectId),
		whatsappConfigQueries.getProjectWhatsappConfig(projectId),
		mattermostConfigQueries.getProjectMattermostConfig(projectId),
	]);
	const configs: Array<[ModelIntegration, { modelSelection?: LlmSelectedModel } | null]> = [
		['slack', slack],
		['teams', teams],
		['telegram', telegram],
		['whatsapp', whatsapp],
		['mattermost', mattermost],
	];
	return configs
		.filter((entry): entry is [ModelIntegration, { modelSelection?: LlmSelectedModel }] => entry[1] !== null)
		.map(([integration, config]) => ({ integration, modelSelection: config.modelSelection ?? null }));
}

export async function updateIntegrationModel(
	projectId: string,
	integration: ModelIntegration,
	selection: LlmSelectedModel | null,
): Promise<void> {
	const provider = selection?.provider ?? null;
	const modelId = selection?.modelId ?? null;

	switch (integration) {
		case 'slack':
			await slackConfigQueries.updateProjectSlackModel(projectId, provider, modelId);
			await slackService.syncProjectSocketMode(
				await slackConfigQueries.getProjectSlackConfig(projectId),
				projectId,
			);
			return;
		case 'teams':
			await teamsConfigQueries.updateProjectTeamsModel(projectId, provider, modelId);
			return;
		case 'telegram':
			await telegramConfigQueries.updateProjectTelegramModel(projectId, provider, modelId);
			return;
		case 'whatsapp':
			await whatsappConfigQueries.updateProjectWhatsappModel(projectId, provider, modelId);
			return;
		case 'mattermost':
			await mattermostConfigQueries.updateProjectMattermostModel(projectId, provider, modelId);
			await mattermostService.syncProject(
				await mattermostConfigQueries.getProjectMattermostConfig(projectId),
				projectId,
			);
			return;
	}
}

function defaultModelOf(provider: LlmProvider): LlmSelectedModel {
	return { provider, modelId: getDefaultModelId(provider) };
}
