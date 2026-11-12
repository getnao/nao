import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	getAllowedLlmConfigIdsForUserModel,
	getAvailableModelsForUser,
	getLlmAccessReadiness,
	resolveUserBackgroundModelId,
	resolveUserBackgroundModelSelection,
	resolveUserModelSelection,
} from '../src/services/user-group-llm-access.service';

const mocks = vi.hoisted(() => ({
	getProjectById: vi.fn(),
	getDefaultModelSettings: vi.fn(),
	getProjectLlmConfigs: vi.fn(),
	resolveAvailableUserGroupAccess: vi.fn(),
	getAvailableUserGroupOverview: vi.fn(),
	getProjectAvailableModels: vi.fn(),
	getProjectAvailableModelsForConfigs: vi.fn(),
	listProjectAutomationModelSelections: vi.fn(),
}));

vi.mock('../src/queries/project.queries', () => ({
	getProjectById: mocks.getProjectById,
	getDefaultModelSettings: mocks.getDefaultModelSettings,
}));

vi.mock('../src/queries/project-llm-config.queries', () => ({
	getProjectLlmConfigs: mocks.getProjectLlmConfigs,
}));

vi.mock('../src/queries/automation.queries', () => ({
	listProjectAutomationModelSelections: mocks.listProjectAutomationModelSelections,
}));

vi.mock('../src/services/user-group-availability.service', () => ({
	resolveAvailableUserGroupAccess: mocks.resolveAvailableUserGroupAccess,
	getAvailableUserGroupOverview: mocks.getAvailableUserGroupOverview,
}));

vi.mock('../src/utils/llm', () => ({
	filterModelsByConfigAccess: (
		models: (typeof clientAModel)[],
		configIds: string[],
		modelIdsByConfig: Record<string, string[]>,
	) =>
		models.filter(
			(model) =>
				model.llmConfigId !== undefined &&
				configIds.includes(model.llmConfigId) &&
				(!Object.hasOwn(modelIdsByConfig, model.llmConfigId) ||
					modelIdsByConfig[model.llmConfigId].includes(model.modelId)),
		),
	getProjectAvailableModels: mocks.getProjectAvailableModels,
	getProjectAvailableModelsForConfigs: mocks.getProjectAvailableModelsForConfigs,
	selectDefaultChatModel: (_settings: unknown, available: unknown[]) => available[0] ?? null,
}));

const clientAModel = {
	provider: 'openai' as const,
	modelId: 'gpt-5-mini',
	name: 'GPT-5 mini',
	baseUrl: null,
	llmConfigId: 'config-a',
	llmConfigName: 'Client A',
};
const clientBModel = { ...clientAModel, llmConfigId: 'config-b', llmConfigName: 'Client B' };

describe('user group LLM access', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getDefaultModelSettings.mockResolvedValue(null);
		mocks.getProjectLlmConfigs.mockResolvedValue([]);
		mocks.resolveAvailableUserGroupAccess.mockResolvedValue({
			llmConfigIds: ['config-a'],
			llmModelIdsByConfig: {},
		});
		mocks.getAvailableUserGroupOverview.mockResolvedValue({ groups: [], users: [], memberships: [] });
		mocks.getProjectAvailableModels.mockResolvedValue([clientAModel, clientBModel]);
		mocks.getProjectAvailableModelsForConfigs.mockResolvedValue([clientAModel]);
		mocks.listProjectAutomationModelSelections.mockResolvedValue([]);
	});

	it('preserves the project catalog in project mode', async () => {
		mocks.getProjectById.mockResolvedValue({ llmAccessMode: 'project' });

		await expect(getAvailableModelsForUser('project-1', 'user-1')).resolves.toEqual([clientAModel, clientBModel]);
		expect(mocks.resolveAvailableUserGroupAccess).not.toHaveBeenCalled();
	});

	it('keeps explicit models outside the picker catalog in project mode', async () => {
		mocks.getProjectById.mockResolvedValue({ llmAccessMode: 'project' });

		await expect(
			resolveUserModelSelection('project-1', 'user-1', {
				provider: 'openai',
				modelId: 'gpt-4.1',
			}),
		).resolves.toEqual({ provider: 'openai', modelId: 'gpt-4.1' });
	});

	it('uses only the union of config ids resolved from the users groups', async () => {
		mocks.getProjectById.mockResolvedValue({ llmAccessMode: 'user_group' });
		mocks.resolveAvailableUserGroupAccess.mockResolvedValue({
			llmConfigIds: ['config-a', 'config-b'],
			llmModelIdsByConfig: { 'config-a': ['gpt-5-mini'] },
		});

		await getAvailableModelsForUser('project-1', 'user-1');

		expect(mocks.getProjectAvailableModelsForConfigs).toHaveBeenCalledWith('project-1', ['config-a', 'config-b'], {
			'config-a': ['gpt-5-mini'],
		});
	});

	it('allows only credentials whose model subset includes the requested model', async () => {
		mocks.getProjectById.mockResolvedValue({ llmAccessMode: 'user_group' });
		mocks.resolveAvailableUserGroupAccess.mockResolvedValue({
			llmConfigIds: ['config-a', 'config-b'],
			llmModelIdsByConfig: {
				'config-a': ['gpt-5-mini'],
				'config-b': ['whisper-1'],
			},
		});

		await expect(getAllowedLlmConfigIdsForUserModel('project-1', 'user-1', 'whisper-1')).resolves.toEqual([
			'config-b',
		]);
	});

	it('rejects a forged credential selection', async () => {
		mocks.getProjectById.mockResolvedValue({ llmAccessMode: 'user_group' });

		await expect(
			resolveUserModelSelection('project-1', 'user-1', {
				provider: 'openai',
				modelId: 'gpt-5-mini',
				llmConfigId: 'config-b',
			}),
		).rejects.toMatchObject({ code: 403 });
	});

	it('rejects a model outside the credential subset', async () => {
		mocks.getProjectById.mockResolvedValue({ llmAccessMode: 'user_group' });

		await expect(
			resolveUserModelSelection('project-1', 'user-1', {
				provider: 'openai',
				modelId: 'gpt-5-pro',
				llmConfigId: 'config-a',
			}),
		).rejects.toMatchObject({ code: 403 });
	});

	it('rejects a legacy selection when multiple authorized credentials expose the same model', async () => {
		mocks.getProjectById.mockResolvedValue({ llmAccessMode: 'user_group' });
		mocks.getProjectAvailableModelsForConfigs.mockResolvedValue([clientAModel, clientBModel]);

		await expect(
			resolveUserModelSelection('project-1', 'user-1', {
				provider: 'openai',
				modelId: 'gpt-5-mini',
			}),
		).rejects.toMatchObject({ code: 400 });
	});

	it('falls back from a stale project default to the users authorized default', async () => {
		mocks.getProjectById.mockResolvedValue({ llmAccessMode: 'user_group' });

		await expect(
			resolveUserBackgroundModelSelection('project-1', 'user-1', {
				provider: 'openai',
				modelId: 'gpt-5-mini',
				llmConfigId: 'config-b',
			}),
		).resolves.toMatchObject({
			provider: 'openai',
			modelId: 'gpt-5-mini',
			llmConfigId: 'config-a',
		});
	});

	it('keeps the authorized model when a background task prefers a restricted model', async () => {
		mocks.getProjectById.mockResolvedValue({ llmAccessMode: 'user_group' });

		await expect(resolveUserBackgroundModelId('project-1', 'user-1', clientAModel, 'gpt-5-pro')).resolves.toBe(
			'gpt-5-mini',
		);
	});

	it('summarizes credentials that activation would ignore or leave unavailable', async () => {
		mocks.getProjectById.mockResolvedValue({ llmAccessMode: 'project' });
		mocks.getProjectLlmConfigs.mockResolvedValue([{ id: 'config-a' }]);
		mocks.getProjectAvailableModels.mockResolvedValue([
			clientAModel,
			{
				...clientAModel,
				provider: 'anthropic',
				llmConfigId: undefined,
				llmConfigName: undefined,
			},
		]);
		mocks.getDefaultModelSettings.mockResolvedValue({
			mode: 'single',
			chat: { provider: 'openai', modelId: 'gpt-5-mini', llmConfigId: 'missing-config' },
		});
		mocks.getAvailableUserGroupOverview.mockResolvedValue({
			groups: [
				{
					id: 'group-1',
					isLocked: false,
					llmConfigIds: ['config-a'],
					llmModelIdsByConfig: {},
				},
			],
			users: [{ id: 'user-1' }],
			memberships: [{ userId: 'user-1', groupId: 'group-1' }],
		});

		await expect(getLlmAccessReadiness('project-1')).resolves.toMatchObject({
			canEnable: true,
			ignoredProviderIds: ['anthropic'],
			staleDefaultCount: 1,
		});
	});

	it('does not report groups as unassigned when they inherit models from All Users', async () => {
		mocks.getProjectById.mockResolvedValue({ llmAccessMode: 'project' });
		mocks.getProjectLlmConfigs.mockResolvedValue([{ id: 'config-a' }]);
		mocks.getAvailableUserGroupOverview.mockResolvedValue({
			groups: [
				{
					id: 'all-users',
					isDefault: true,
					isLocked: false,
					llmConfigIds: ['config-a'],
					llmModelIdsByConfig: {},
				},
				{
					id: 'group-1',
					isDefault: false,
					isLocked: false,
					llmConfigIds: [],
					llmModelIdsByConfig: {},
				},
			],
			users: [{ id: 'user-1' }],
			memberships: [
				{ userId: 'user-1', groupId: 'all-users' },
				{ userId: 'user-1', groupId: 'group-1' },
			],
		});

		await expect(getLlmAccessReadiness('project-1')).resolves.toMatchObject({
			canEnable: true,
			unassignedGroupIds: [],
			userIdsWithoutModels: [],
		});
	});

	it('does not report empty groups when their members have models from another group', async () => {
		mocks.getProjectById.mockResolvedValue({ llmAccessMode: 'project' });
		mocks.getProjectLlmConfigs.mockResolvedValue([{ id: 'config-a' }]);
		mocks.getAvailableUserGroupOverview.mockResolvedValue({
			groups: [
				{
					id: 'all-users',
					isDefault: true,
					isLocked: false,
					llmConfigIds: [],
					llmModelIdsByConfig: {},
				},
				{
					id: 'group-with-models',
					isDefault: false,
					isLocked: false,
					llmConfigIds: ['config-a'],
					llmModelIdsByConfig: {},
				},
				{
					id: 'group-without-models',
					isDefault: false,
					isLocked: false,
					llmConfigIds: [],
					llmModelIdsByConfig: {},
				},
			],
			users: [{ id: 'user-1' }],
			memberships: [
				{ userId: 'user-1', groupId: 'all-users' },
				{ userId: 'user-1', groupId: 'group-with-models' },
				{ userId: 'user-1', groupId: 'group-without-models' },
			],
		});

		await expect(getLlmAccessReadiness('project-1')).resolves.toMatchObject({
			canEnable: true,
			unassignedGroupIds: [],
			userIdsWithoutModels: [],
		});
	});

	it('accepts a legacy default when each eligible user can resolve one matching credential', async () => {
		mocks.getProjectById.mockResolvedValue({ llmAccessMode: 'project' });
		mocks.getProjectLlmConfigs.mockResolvedValue([{ id: 'config-a' }, { id: 'config-b' }]);
		mocks.getDefaultModelSettings.mockResolvedValue({
			mode: 'single',
			chat: { provider: 'openai', modelId: 'gpt-5-mini' },
		});
		mocks.getAvailableUserGroupOverview.mockResolvedValue({
			groups: [
				{
					id: 'all-users',
					isDefault: true,
					isLocked: false,
					llmConfigIds: ['config-a'],
					llmModelIdsByConfig: {},
				},
			],
			users: [{ id: 'user-1' }],
			memberships: [{ userId: 'user-1', groupId: 'all-users' }],
		});

		await expect(getLlmAccessReadiness('project-1')).resolves.toMatchObject({
			staleDefaultCount: 0,
		});
	});

	it('reports a project default that no eligible user can access', async () => {
		mocks.getProjectById.mockResolvedValue({ llmAccessMode: 'project' });
		mocks.getProjectLlmConfigs.mockResolvedValue([{ id: 'config-a' }, { id: 'config-b' }]);
		mocks.getDefaultModelSettings.mockResolvedValue({
			mode: 'single',
			chat: { provider: 'openai', modelId: 'gpt-5-mini', llmConfigId: 'config-b' },
		});
		mocks.getAvailableUserGroupOverview.mockResolvedValue({
			groups: [
				{
					id: 'all-users',
					isDefault: true,
					isLocked: false,
					llmConfigIds: ['config-a'],
					llmModelIdsByConfig: {},
				},
			],
			users: [{ id: 'user-1' }],
			memberships: [{ userId: 'user-1', groupId: 'all-users' }],
		});

		await expect(getLlmAccessReadiness('project-1')).resolves.toMatchObject({
			staleDefaultCount: 1,
		});
	});

	it('does not enable group access when every assigned model subset is empty', async () => {
		mocks.getProjectById.mockResolvedValue({ llmAccessMode: 'project' });
		mocks.getProjectLlmConfigs.mockResolvedValue([{ id: 'config-a' }]);
		mocks.getAvailableUserGroupOverview.mockResolvedValue({
			groups: [
				{
					id: 'group-1',
					isLocked: false,
					llmConfigIds: ['config-a'],
					llmModelIdsByConfig: { 'config-a': [] },
				},
			],
			users: [{ id: 'user-1' }],
			memberships: [{ userId: 'user-1', groupId: 'group-1' }],
		});

		await expect(getLlmAccessReadiness('project-1')).resolves.toMatchObject({
			canEnable: false,
			unassignedGroupIds: ['group-1'],
			userIdsWithoutModels: ['user-1'],
		});
	});
});
