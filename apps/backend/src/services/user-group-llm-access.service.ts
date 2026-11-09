import type { LlmAccessMode, LlmSelectedModel } from '@nao/shared/types';

import * as automationQueries from '../queries/automation.queries';
import * as projectQueries from '../queries/project.queries';
import * as projectLlmConfigQueries from '../queries/project-llm-config.queries';
import { mergeUserGroupLlmAccess } from '../queries/user-group.queries';
import { HandlerError } from '../utils/error';
import {
	filterModelsByConfigAccess,
	getProjectAvailableModels,
	getProjectAvailableModelsForConfigs,
	type ProjectAvailableModel,
	selectDefaultChatModel,
} from '../utils/llm';
import { getAvailableUserGroupOverview, resolveAvailableUserGroupAccess } from './user-group-availability.service';

export interface LlmAccessReadiness {
	mode: LlmAccessMode;
	assignedConfigCount: number;
	staleConfigIds: string[];
	unassignedGroupIds: string[];
	userIdsWithoutModels: string[];
	ignoredProviderIds: string[];
	staleDefaultCount: number;
	staleAutomationIds: string[];
	canEnable: boolean;
}

export async function getLlmAccessReadiness(projectId: string): Promise<LlmAccessReadiness> {
	const [mode, configs, overview, projectModels, defaultSettings, automations] = await Promise.all([
		getProjectLlmAccessMode(projectId),
		projectLlmConfigQueries.getProjectLlmConfigs(projectId),
		getAvailableUserGroupOverview(projectId),
		getProjectAvailableModels(projectId),
		projectQueries.getDefaultModelSettings(projectId),
		automationQueries.listProjectAutomationModelSelections(projectId),
	]);
	const configIds = new Set(configs.map((config) => config.id));
	const activeGroups = overview.groups.filter((group) => !group.isLocked);
	const assignedIds = new Set(
		activeGroups
			.flatMap((group) => ('llmConfigIds' in group ? group.llmConfigIds : []))
			.filter((id) => configIds.has(id)),
	);
	const configuredIds = activeGroups.flatMap((group) => ('llmConfigIds' in group ? group.llmConfigIds : []));
	const databaseModels = projectModels.filter((model) => model.llmConfigId);
	const groupsWithoutModels = activeGroups
		.filter((group) => {
			if (!('llmConfigIds' in group) || !('llmModelIdsByConfig' in group)) {
				return true;
			}
			const access = mergeUserGroupLlmAccess([group]);
			return (
				filterModelsByConfigAccess(databaseModels, access.llmConfigIds, access.llmModelIdsByConfig).length === 0
			);
		})
		.map((group) => group.id);
	const userModelsById = new Map(
		overview.users.map((user) => {
			const groupIds = new Set(
				overview.memberships
					.filter((membership) => membership.userId === user.id)
					.map((membership) => membership.groupId),
			);
			const access = mergeUserGroupLlmAccess(
				activeGroups.filter(
					(group) => groupIds.has(group.id) && 'llmConfigIds' in group && 'llmModelIdsByConfig' in group,
				),
			);
			return [
				user.id,
				filterModelsByConfigAccess(databaseModels, access.llmConfigIds, access.llmModelIdsByConfig),
			] as const;
		}),
	);
	const userIdsWithoutModels = overview.users
		.filter((user) => userModelsById.get(user.id)?.length === 0)
		.map((user) => user.id);
	const staleDefaultCount = getConfiguredDefaults(defaultSettings).filter(
		(selection) => !hasAvailableSelection(databaseModels, selection),
	).length;
	const automationModelsByUser = new Map(
		[...new Set(automations.map((automation) => automation.userId))].map(
			(userId) => [userId, userModelsById.get(userId) ?? []] as const,
		),
	);
	return {
		mode,
		assignedConfigCount: assignedIds.size,
		staleConfigIds: [...new Set(configuredIds.filter((id) => !configIds.has(id)))],
		unassignedGroupIds: groupsWithoutModels,
		userIdsWithoutModels,
		ignoredProviderIds: [
			...new Set(projectModels.filter((model) => !model.llmConfigId).map((model) => model.provider)),
		],
		staleDefaultCount,
		staleAutomationIds: automations
			.filter((automation) => {
				if (!automation.modelProvider || !automation.modelId) {
					return false;
				}
				return !hasAvailableSelection(automationModelsByUser.get(automation.userId) ?? [], {
					provider: automation.modelProvider,
					modelId: automation.modelId,
					...(automation.llmConfigId && { llmConfigId: automation.llmConfigId }),
				});
			})
			.map((automation) => automation.id),
		canEnable: [...userModelsById.values()].some((models) => models.length > 0),
	};
}

export async function getAvailableModelsForUser(projectId: string, userId: string): Promise<ProjectAvailableModel[]> {
	const mode = await getProjectLlmAccessMode(projectId);
	if (mode === 'project') {
		return getProjectAvailableModels(projectId);
	}
	const access = await resolveAvailableUserGroupAccess(projectId, userId);
	return getProjectAvailableModelsForConfigs(projectId, access.llmConfigIds, access.llmModelIdsByConfig);
}

export async function getDefaultChatModelForUser(projectId: string, userId: string): Promise<LlmSelectedModel | null> {
	const [settings, available] = await Promise.all([
		projectQueries.getDefaultModelSettings(projectId),
		getAvailableModelsForUser(projectId, userId),
	]);
	return selectDefaultChatModel(settings, available);
}

export async function resolveUserModelSelection(
	projectId: string,
	userId: string,
	requested?: LlmSelectedModel,
): Promise<LlmSelectedModel> {
	const [mode, available] = await Promise.all([
		getProjectLlmAccessMode(projectId),
		getAvailableModelsForUser(projectId, userId),
	]);
	if (!requested) {
		const selected = selectDefaultChatModel(await projectQueries.getDefaultModelSettings(projectId), available);
		if (selected) {
			return selected;
		}
		throw new HandlerError('BAD_REQUEST', 'No model is available for this user.');
	}

	const candidates = available.filter(
		(model) => model.provider === requested.provider && model.modelId === requested.modelId,
	);
	if (requested.llmConfigId) {
		const exact = candidates.find((model) => model.llmConfigId === requested.llmConfigId);
		if (exact) {
			return toSelection(exact);
		}
		throw new HandlerError('FORBIDDEN', 'The selected model is not available for this user.');
	}
	if (candidates.length === 1 || (mode === 'project' && candidates.length > 0)) {
		return toSelection(candidates[0]);
	}
	if (candidates.length > 1) {
		throw new HandlerError('BAD_REQUEST', 'Select a credential for this model and try again.');
	}
	throw new HandlerError('FORBIDDEN', 'The selected model is not available for this user.');
}

export async function resolveUserBackgroundModelSelection(
	projectId: string,
	userId: string,
	requested?: LlmSelectedModel | null,
): Promise<LlmSelectedModel> {
	if (requested) {
		try {
			return await resolveUserModelSelection(projectId, userId, requested);
		} catch (error) {
			if (!(error instanceof HandlerError)) {
				throw error;
			}
		}
	}
	return resolveUserModelSelection(projectId, userId);
}

export async function resolveUserBackgroundModelId(
	projectId: string,
	userId: string,
	selection: LlmSelectedModel,
	preferredModelId: string,
): Promise<string> {
	try {
		return (
			await resolveUserModelSelection(projectId, userId, {
				...selection,
				modelId: preferredModelId,
			})
		).modelId;
	} catch (error) {
		if (!(error instanceof HandlerError)) {
			throw error;
		}
		return selection.modelId;
	}
}

export async function getProjectLlmAccessMode(projectId: string): Promise<LlmAccessMode> {
	return (await projectQueries.getProjectById(projectId))?.llmAccessMode ?? 'project';
}

function toSelection(model: ProjectAvailableModel): LlmSelectedModel {
	return {
		provider: model.provider,
		modelId: model.modelId,
		...(model.llmConfigId && { llmConfigId: model.llmConfigId }),
	};
}

function getConfiguredDefaults(
	settings: Awaited<ReturnType<typeof projectQueries.getDefaultModelSettings>>,
): LlmSelectedModel[] {
	if (!settings) {
		return [];
	}
	return [settings.chat, settings.single, ...Object.values(settings.categories ?? {})].filter(
		(selection): selection is LlmSelectedModel => selection !== undefined,
	);
}

function hasAvailableSelection(available: ProjectAvailableModel[], selection: LlmSelectedModel): boolean {
	const matches = available.filter(
		(model) => model.provider === selection.provider && model.modelId === selection.modelId,
	);
	return selection.llmConfigId
		? matches.some((model) => model.llmConfigId === selection.llmConfigId)
		: matches.length === 1;
}
