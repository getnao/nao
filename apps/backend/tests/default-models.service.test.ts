import { isSameModel } from '@nao/shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateIntegrationModel } from '../src/services/default-models.service';

const mocks = vi.hoisted(() => ({
	getProjectAvailableModels: vi.fn(),
	resolveAvailableModelSelection: vi.fn(),
	updateProjectTeamsModel: vi.fn(),
}));

vi.mock('../src/utils/llm', () => ({
	getDefaultModelId: vi.fn(),
	getProjectAvailableModels: mocks.getProjectAvailableModels,
	resolveAnnotationModelId: vi.fn(),
	resolveAvailableModelSelection: mocks.resolveAvailableModelSelection,
	selectDefaultChatModel: vi.fn(),
}));

vi.mock('../src/queries/project-teams-config.queries', () => ({
	updateProjectTeamsModel: mocks.updateProjectTeamsModel,
}));

vi.mock('../src/services/discord', () => ({ discordService: {} }));
vi.mock('../src/services/mattermost', () => ({ mattermostService: {} }));
vi.mock('../src/services/slack', () => ({ slackService: {} }));

const availableModel = {
	provider: 'openai' as const,
	modelId: 'gpt-5-mini',
	name: 'GPT-5 mini',
	baseUrl: null,
	llmConfigId: 'config-a',
	llmConfigName: 'Client A',
};

describe('updateIntegrationModel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getProjectAvailableModels.mockResolvedValue([availableModel]);
		mocks.resolveAvailableModelSelection.mockImplementation((available, selection) => {
			return available.find((model) => isSameModel(model, selection)) ?? null;
		});
	});

	it('persists an available project credential', async () => {
		await updateIntegrationModel('project-1', 'teams', {
			provider: 'openai',
			modelId: 'gpt-5-mini',
			llmConfigId: 'config-a',
		});

		expect(mocks.updateProjectTeamsModel).toHaveBeenCalledWith('project-1', 'openai', 'gpt-5-mini', 'config-a');
	});

	it.each([
		['a credential outside the project', 'openai', 'config-b'],
		['a credential whose provider does not match', 'anthropic', 'config-a'],
	] as const)('rejects %s', async (_description, provider, llmConfigId) => {
		await expect(
			updateIntegrationModel('project-1', 'teams', {
				provider,
				modelId: 'gpt-5-mini',
				llmConfigId,
			}),
		).rejects.toMatchObject({
			code: 400,
			message: 'The selected model is not available for this project.',
		});
		expect(mocks.updateProjectTeamsModel).not.toHaveBeenCalled();
	});
});
