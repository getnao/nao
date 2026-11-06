import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	listProjectIds: vi.fn(),
	getAllProjectLlmConfigs: vi.fn(),
	createEnvProjectLlmConfig: vi.fn(),
	getEnvProviders: vi.fn(),
}));

vi.mock('../src/queries/project.queries', () => ({
	listProjectIds: mocks.listProjectIds,
}));

vi.mock('../src/queries/project-llm-config.queries', () => ({
	getAllProjectLlmConfigs: mocks.getAllProjectLlmConfigs,
	createEnvProjectLlmConfig: mocks.createEnvProjectLlmConfig,
}));

vi.mock('../src/utils/llm', () => ({
	getEnvProviders: mocks.getEnvProviders,
}));

import { registerEnvLlmConfigs, registerEnvLlmConfigsForAllProjects } from '../src/services/env-llm-config.service';

describe('environment LLM credential registration', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getEnvProviders.mockReturnValue(['openai', 'anthropic']);
		mocks.getAllProjectLlmConfigs.mockResolvedValue([]);
		mocks.createEnvProjectLlmConfig.mockResolvedValue(true);
	});

	it('registers every configured environment provider with its provider name', async () => {
		await expect(registerEnvLlmConfigs('project-1')).resolves.toBe(2);

		expect(mocks.createEnvProjectLlmConfig).toHaveBeenCalledWith('project-1', 'openai', 'OpenAI');
		expect(mocks.createEnvProjectLlmConfig).toHaveBeenCalledWith('project-1', 'anthropic', 'Anthropic');
	});

	it('does not duplicate an active manual credential or recreate a deactivated ENV credential', async () => {
		mocks.getAllProjectLlmConfigs.mockResolvedValue([
			{ provider: 'openai', credentialSource: 'database', disabledAt: null },
			{ provider: 'anthropic', credentialSource: 'env', disabledAt: new Date() },
		]);

		await expect(registerEnvLlmConfigs('project-1')).resolves.toBe(0);
		expect(mocks.createEnvProjectLlmConfig).not.toHaveBeenCalled();
	});

	it('restores ENV ownership after a manual override was deactivated', async () => {
		mocks.getEnvProviders.mockReturnValue(['openai']);
		mocks.getAllProjectLlmConfigs.mockResolvedValue([
			{ provider: 'openai', credentialSource: 'database', disabledAt: new Date() },
		]);

		await expect(registerEnvLlmConfigs('project-1')).resolves.toBe(1);
		expect(mocks.createEnvProjectLlmConfig).toHaveBeenCalledWith('project-1', 'openai', 'OpenAI');
	});

	it('registers credentials for every existing project', async () => {
		mocks.listProjectIds.mockResolvedValue(['project-1', 'project-2']);

		await expect(registerEnvLlmConfigsForAllProjects()).resolves.toBe(4);
		expect(mocks.getAllProjectLlmConfigs).toHaveBeenCalledWith('project-1');
		expect(mocks.getAllProjectLlmConfigs).toHaveBeenCalledWith('project-2');
	});

	it('does nothing when no eligible environment provider is configured', async () => {
		mocks.getEnvProviders.mockReturnValue([]);

		await expect(registerEnvLlmConfigs('project-1')).resolves.toBe(0);
		expect(mocks.getAllProjectLlmConfigs).not.toHaveBeenCalled();
	});
});
