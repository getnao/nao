import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __reloadEnvForTesting } from '../src/env';
import { getProjectAvailableModels, resolveProviderModel } from '../src/utils/llm';

const mocks = vi.hoisted(() => ({
	getProjectById: vi.fn(),
	getProjectLlmConfigs: vi.fn(),
	getManagedAiBalance: vi.fn(),
}));

vi.mock('../src/queries/project.queries', () => ({
	getProjectById: mocks.getProjectById,
}));

vi.mock('../src/queries/project-llm-config.queries', () => ({
	getProjectLlmConfigs: mocks.getProjectLlmConfigs,
	getProjectLlmConfigByProvider: vi.fn(),
}));

vi.mock('../src/queries/managed-ai-usage.queries', () => ({
	getManagedAiBalance: mocks.getManagedAiBalance,
}));

vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const dirs: string[] = [];
let originalEnv: NodeJS.ProcessEnv;

function writeConfig(lines: string[]): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-available-models-'));
	dirs.push(dir);
	fs.writeFileSync(path.join(dir, 'nao_config.yaml'), lines.join('\n'));
	return dir;
}

describe('getProjectAvailableModels', () => {
	beforeEach(() => {
		originalEnv = { ...process.env };
		process.env.NAO_MODE = 'cloud';
		__reloadEnvForTesting();
		vi.clearAllMocks();
		mocks.getProjectLlmConfigs.mockResolvedValue([]);
		mocks.getManagedAiBalance.mockResolvedValue({
			spentMicroUsd: 0,
			remainingMicroUsd: 5_000_000,
			allowanceMicroUsd: 5_000_000,
		});
	});

	afterEach(() => {
		process.env = originalEnv;
		__reloadEnvForTesting();
		while (dirs.length > 0) {
			fs.rmSync(dirs.pop() as string, { force: true, recursive: true });
		}
	});

	it('lists the curated nao models only when the project has no other provider', async () => {
		process.env.NAO_MANAGED_OPENAI_API_KEY = 'managed-key';
		mocks.getProjectById.mockResolvedValue(null);

		const managed = await getProjectAvailableModels('project-1', 'user-1');
		expect(managed.map(({ provider, modelId }) => ({ provider, modelId }))).toEqual([
			{ provider: 'nao', modelId: 'gpt-5.6-luna' },
			{ provider: 'nao', modelId: 'gpt-5.6-terra' },
			{ provider: 'nao', modelId: 'gpt-5.6-sol' },
		]);
		await expect(
			resolveProviderModel('project-1', 'nao', 'gpt-5.6-luna', true, { userId: 'user-1' }),
		).resolves.not.toBeNull();
		await expect(
			resolveProviderModel('project-1', 'nao', 'gpt-5.6-pro', true, { userId: 'user-1' }),
		).resolves.toBeNull();

		mocks.getProjectLlmConfigs.mockResolvedValue([
			{
				provider: 'openai',
				enabledModels: ['gpt-5-mini'],
				customModels: [],
				baseUrl: null,
			},
		]);
		const byok = await getProjectAvailableModels('project-1', 'user-1');
		expect(byok).toHaveLength(1);
		expect(byok[0]).toMatchObject({ provider: 'openai', modelId: 'gpt-5-mini' });
		await expect(
			resolveProviderModel('project-1', 'nao', 'gpt-5.6-luna', true, { userId: 'user-1' }),
		).resolves.toBeNull();
	});

	it('never exposes the managed provider in self-hosted mode', async () => {
		process.env.NAO_MANAGED_OPENAI_API_KEY = 'managed-key';
		process.env.NAO_MODE = 'self-hosted';
		__reloadEnvForTesting();
		mocks.getProjectById.mockResolvedValue(null);

		const models = await getProjectAvailableModels('project-1', 'user-1');
		expect(models.some(({ provider }) => provider === 'nao')).toBe(false);
		await expect(
			resolveProviderModel('project-1', 'nao', 'gpt-5.6-luna', true, { userId: 'user-1' }),
		).resolves.toBeNull();
		expect(mocks.getManagedAiBalance).not.toHaveBeenCalled();
	});

	it('lists models from every named openai-compatible endpoint in nao_config.yaml', async () => {
		const dir = writeConfig([
			'llm:',
			'  providers:',
			'  - provider: openai-compatible',
			'    name: prod',
			'    base_url: http://prod:8000/v1',
			'    models:',
			'    - id: gpt-5.5',
			'  - provider: openai-compatible',
			'    name: staging',
			'    base_url: http://staging:8000/v1',
			'    models:',
			'    - id: claude-opus-4-8',
		]);
		mocks.getProjectById.mockResolvedValue({ path: dir, envVars: {} });

		const models = (await getProjectAvailableModels('project-1')).filter((model) =>
			model.provider.startsWith('openaiCompatible/'),
		);

		expect(models).toEqual([
			{
				provider: 'openaiCompatible/prod',
				modelId: 'gpt-5.5',
				name: 'gpt-5.5',
				baseUrl: 'http://prod:8000/v1',
			},
			{
				provider: 'openaiCompatible/staging',
				modelId: 'claude-opus-4-8',
				name: 'claude-opus-4-8',
				baseUrl: 'http://staging:8000/v1',
			},
		]);
	});
});
