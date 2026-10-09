import type { BackgroundModelCategory, DefaultModelSettings } from '@nao/shared';
import type { LlmProvider, LlmSelectedModel } from '@nao/shared/types';

import { getProviderMeta } from '../agents/providers';
import * as projectQueries from '../queries/project.queries';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import * as mattermostConfigQueries from '../queries/project-mattermost-config.queries';
import * as slackConfigQueries from '../queries/project-slack-config.queries';
import * as teamsConfigQueries from '../queries/project-teams-config.queries';
import * as telegramConfigQueries from '../queries/project-telegram-config.queries';
import * as whatsappConfigQueries from '../queries/project-whatsapp-config.queries';
import {
	getDefaultModelId,
	getProjectAvailableModels,
	resolveAnnotationModelId,
	selectDefaultChatModel,
} from '../utils/llm';
import { mattermostService } from './mattermost';
import { slackService } from './slack';

export const MODEL_INTEGRATIONS = ['slack', 'teams', 'telegram', 'whatsapp', 'mattermost'] as const;

export type ModelIntegration = (typeof MODEL_INTEGRATIONS)[number];

export interface ResolvedDefaultModel extends LlmSelectedModel {
	name: string;
}

/** What each "nao default" option stands for when nothing is pinned. */
export interface BuiltInDefaultModels {
	chat: ResolvedDefaultModel | null;
	categories: Partial<Record<BackgroundModelCategory, ResolvedDefaultModel>>;
}

export interface DefaultModelsOverview {
	settings: DefaultModelSettings | null;
	availableModels: AvailableModel[];
	/** The model runs without an explicit selection use today, pinned or not. */
	chatModel: ResolvedDefaultModel | null;
	builtInDefaults: BuiltInDefaultModels;
}

export interface IntegrationModel {
	integration: ModelIntegration;
	modelSelection: LlmSelectedModel | null;
}

type AvailableModel = Awaited<ReturnType<typeof getProjectAvailableModels>>[number];

/** Loads the settings and the model catalog once and derives every default from them. */
export async function getDefaultModelsOverview(projectId: string): Promise<DefaultModelsOverview> {
	const [settings, availableModels] = await Promise.all([
		projectQueries.getDefaultModelSettings(projectId),
		getProjectAvailableModels(projectId),
	]);
	const chat = selectDefaultChatModel(settings, availableModels);
	const named = (selection: LlmSelectedModel): ResolvedDefaultModel => ({
		...selection,
		name: nameModel(availableModels, selection),
	});

	return {
		settings,
		availableModels,
		chatModel: chat ? named(chat) : null,
		builtInDefaults: {
			chat: availableModels.length > 0 ? named(availableModels[0]) : null,
			categories: chat ? await resolveBuiltInTaskModels(projectId, chat, named) : {},
		},
	};
}

/**
 * The model each background task falls back to when nothing is pinned, mirroring the services:
 * live stories and automation titles start from the project's preferred provider, while tasks
 * tied to a conversation (compaction, memory) derive their model from the conversation's one,
 * so they are resolved against the chat default.
 */
async function resolveBuiltInTaskModels(
	projectId: string,
	chat: LlmSelectedModel,
	named: (selection: LlmSelectedModel) => ResolvedDefaultModel,
): Promise<BuiltInDefaultModels['categories']> {
	const taskProvider = await llmConfigQueries.getProjectModelProvider(projectId);
	const annotationModel = async (fallbackModelId: string): Promise<LlmSelectedModel> => ({
		provider: chat.provider,
		modelId: await resolveAnnotationModelId(projectId, chat, fallbackModelId),
	});
	const [title, extractor] = await Promise.all([
		taskProvider
			? { provider: taskProvider, modelId: getProviderMeta(taskProvider).summaryModelId }
			: annotationModel(getProviderMeta(chat.provider).summaryModelId),
		annotationModel(getProviderMeta(chat.provider).extractorModelId),
	]);

	return {
		...(taskProvider && { live_story: named(defaultModelOf(taskProvider)) }),
		title: named(title),
		compaction: named(extractor),
		context_recommendation: named(chat),
		other: named(extractor),
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

/** Names a model the way the picker does, falling back to nao's catalogue for models the project does not list. */
function nameModel(availableModels: AvailableModel[], { provider, modelId }: LlmSelectedModel): string {
	const listed = availableModels.find((model) => model.provider === provider && model.modelId === modelId);
	return listed?.name ?? getProviderMeta(provider).models.find((model) => model.id === modelId)?.name ?? modelId;
}
