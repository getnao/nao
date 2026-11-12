import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getAgentSettings: vi.fn(),
	getAllowedLlmConfigIdsForUserModel: vi.fn(),
	getAvailableModelsForUser: vi.fn(),
	resolveProviderSettings: vi.fn(),
	transcribe: vi.fn(),
}));

vi.mock('ai', () => ({ experimental_transcribe: mocks.transcribe }));
vi.mock('../../src/queries/project.queries', () => ({ getAgentSettings: mocks.getAgentSettings }));
vi.mock('../../src/utils/llm', () => ({ resolveProviderSettings: mocks.resolveProviderSettings }));
vi.mock('../../src/services/user-group-llm-access.service', () => ({
	getAllowedLlmConfigIdsForUserModel: mocks.getAllowedLlmConfigIdsForUserModel,
	getAvailableModelsForUser: mocks.getAvailableModelsForUser,
}));

import { transcribeAudio } from '../../src/services/transcribe.service';

describe('transcribeAudio', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getAgentSettings.mockResolvedValue(null);
		mocks.getAllowedLlmConfigIdsForUserModel.mockResolvedValue([]);
		mocks.getAvailableModelsForUser.mockResolvedValue([]);
	});

	it('rejects a transcription model excluded from the users credential subset', async () => {
		await expect(
			transcribeAudio('project-1', 'user-1', '', { provider: 'openai', modelId: 'whisper-1' }),
		).rejects.toThrow('No API key configured for openai');

		expect(mocks.getAllowedLlmConfigIdsForUserModel).toHaveBeenCalledWith('project-1', 'user-1', 'whisper-1');
		expect(mocks.resolveProviderSettings).not.toHaveBeenCalled();
		expect(mocks.transcribe).not.toHaveBeenCalled();
	});
});
