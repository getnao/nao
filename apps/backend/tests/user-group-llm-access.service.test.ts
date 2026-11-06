import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	getAvailableModelsForUser,
	getLlmAccessReadiness,
	resolveModelForUser,
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
	resolveProviderModel: vi.fn(),
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
	getProjectAvailableModels: mocks.getProjectAvailableModels,
	getProjectAvailableModelsForConfigs: mocks.getProjectAvailableModelsForConfigs,
	resolveProviderModel: mocks.resolveProviderModel,
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
		mocks.resolveAvailableUserGroupAccess.mockResolvedValue({ llmConfigIds: ['config-a'] });
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

	it('uses only the union of config ids resolved from the users groups', async () => {
		mocks.getProjectById.mockResolvedValue({ llmAccessMode: 'user_group' });
		mocks.resolveAvailableUserGroupAccess.mockResolvedValue({ llmConfigIds: ['config-a', 'config-b'] });

		await getAvailableModelsForUser('project-1', 'user-1');

		expect(mocks.getProjectAvailableModelsForConfigs).toHaveBeenCalledWith('project-1', ['config-a', 'config-b']);
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

	it('passes the authorized credential id to provider resolution', async () => {
		mocks.getProjectById.mockResolvedValue({ llmAccessMode: 'user_group' });
		mocks.resolveProviderModel.mockResolvedValue({ model: { modelId: 'gpt-5-mini' } });

		await resolveModelForUser('project-1', 'user-1', {
			provider: 'openai',
			modelId: 'gpt-5-mini',
			llmConfigId: 'config-a',
		});

		expect(mocks.resolveProviderModel).toHaveBeenCalledWith(
			'project-1',
			'openai',
			'gpt-5-mini',
			true,
			undefined,
			undefined,
			'config-a',
		);
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
			groups: [{ id: 'group-1', isLocked: false, llmConfigIds: ['config-a'] }],
			users: [{ id: 'user-1' }],
			memberships: [{ userId: 'user-1', groupId: 'group-1' }],
		});

		await expect(getLlmAccessReadiness('project-1')).resolves.toMatchObject({
			canEnable: true,
			ignoredProviderIds: ['anthropic'],
			staleDefaultCount: 1,
		});
	});
});
