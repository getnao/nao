import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __reloadEnvForTesting } from '../src/env';
import { getProjectAvailableModels, resolveProviderModel } from '../src/utils/llm';

const mocks = vi.hoisted(() => ({
	getProjectById: vi.fn(),
	getProjectLlmConfigs: vi.fn(),
	getCreditBalance: vi.fn(),
}));

vi.mock('../src/queries/project.queries', () => ({
	getProjectById: mocks.getProjectById,
}));

vi.mock('../src/queries/project-llm-config.queries', () => ({
	getProjectLlmConfigs: mocks.getProjectLlmConfigs,
	getProjectLlmConfigByProvider: vi.fn(),
}));

vi.mock('../src/queries/credit-wallet.queries', () => ({
	getCreditBalance: mocks.getCreditBalance,
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

function enableManagedAi(): void {
	process.env.NAO_MANAGED_OPENAI_API_KEY = 'managed-key';
	__reloadEnvForTesting();
}

describe('getProjectAvailableModels', () => {
	beforeEach(() => {
		originalEnv = { ...process.env };
		process.env.NAO_MODE = 'cloud';
		process.env.CLOUD_GITHUB_PROJECT_ORG = 'test-org';
		process.env.CLOUD_GITHUB_PROJECT_APP_ID = '123';
		process.env.CLOUD_GITHUB_PROJECT_INSTALLATION_ID = '456';
		process.env.CLOUD_GITHUB_PROJECT_PRIVATE_KEY = 'test-private-key';
		__reloadEnvForTesting();
		vi.clearAllMocks();
		mocks.getProjectLlmConfigs.mockResolvedValue([]);
		mocks.getCreditBalance.mockResolvedValue(0);
	});

	afterEach(() => {
		process.env = originalEnv;
		__reloadEnvForTesting();
		while (dirs.length > 0) {
			fs.rmSync(dirs.pop() as string, { force: true, recursive: true });
		}
	});

	it('keeps the curated nao models available after BYOK is configured', async () => {
		enableManagedAi();
		mocks.getProjectById.mockResolvedValue({ id: 'project-1', orgId: 'org-1', path: null, envVars: {} });
		mocks.getCreditBalance.mockResolvedValue(480_000);

		const managed = await getProjectAvailableModels('project-1');
		expect(managed.map(({ provider, modelId }) => ({ provider, modelId }))).toEqual([
			{ provider: 'nao', modelId: 'gpt-6-luna' },
			{ provider: 'nao', modelId: 'gpt-6-sol' },
		]);
		expect(mocks.getCreditBalance).toHaveBeenCalledWith('org-1');
		await expect(
			resolveProviderModel('project-1', 'nao', 'gpt-6-luna', true, {
				userId: 'user-1',
				category: 'chat',
			}),
		).resolves.not.toBeNull();
		for (const [legacyModelId, currentModelId] of [
			['gpt-5.6-luna', 'gpt-6-luna'],
			['gpt-5.6-terra', 'gpt-6-sol'],
			['gpt-5.6-sol', 'gpt-6-sol'],
		]) {
			const resolved = await resolveProviderModel('project-1', 'nao', legacyModelId, true, {
				userId: 'user-1',
				category: 'chat',
			});
			expect(resolved?.model.modelId).toBe(currentModelId);
		}

		mocks.getProjectLlmConfigs.mockResolvedValue([
			{
				provider: 'openai',
				enabledModels: ['gpt-5-mini'],
				customModels: [],
				baseUrl: null,
			},
		]);
		const byok = await getProjectAvailableModels('project-1');
		expect(byok.map(({ provider, modelId }) => ({ provider, modelId }))).toEqual([
			{ provider: 'openai', modelId: 'gpt-5-mini' },
			{ provider: 'nao', modelId: 'gpt-6-luna' },
			{ provider: 'nao', modelId: 'gpt-6-sol' },
		]);
		await expect(
			resolveProviderModel('project-1', 'nao', 'gpt-6-luna', true, {
				userId: 'user-1',
				category: 'chat',
			}),
		).resolves.not.toBeNull();
		mocks.getProjectLlmConfigs.mockClear();
		await expect(
			resolveProviderModel('project-1', 'nao', 'gpt-6-sol', true, {
				userId: 'user-1',
				category: 'chat',
				billingMode: 'unbilled',
			}),
		).resolves.not.toBeNull();
		expect(mocks.getProjectLlmConfigs).not.toHaveBeenCalled();
	});

	it('hides managed models when the wallet has no credits', async () => {
		enableManagedAi();
		mocks.getProjectById.mockResolvedValue({ id: 'project-1', orgId: 'org-1', path: null, envVars: {} });
		mocks.getCreditBalance.mockResolvedValue(0);

		const models = await getProjectAvailableModels('project-1');

		expect(models.some(({ provider }) => provider === 'nao')).toBe(false);
	});

	it('offers managed models when an environment provider has no selectable model', async () => {
		enableManagedAi();
		process.env.OPENAI_COMPATIBLE_BASE_URL = 'http://localhost:8000/v1';
		mocks.getProjectById.mockResolvedValue({ id: 'project-1', orgId: 'org-1', path: null, envVars: {} });
		mocks.getCreditBalance.mockResolvedValue(19_200);

		const models = await getProjectAvailableModels('project-1');

		expect(models.filter(({ provider }) => provider === 'nao').map(({ modelId }) => modelId)).toEqual([
			'gpt-6-luna',
			'gpt-6-sol',
		]);
		await expect(
			resolveProviderModel('project-1', 'nao', 'gpt-6-luna', true, {
				userId: 'user-1',
				category: 'chat',
			}),
		).resolves.not.toBeNull();
	});

	it('never exposes the managed provider in self-hosted mode', async () => {
		process.env.NAO_MANAGED_OPENAI_API_KEY = 'managed-key';
		process.env.NAO_MODE = 'self-hosted';
		__reloadEnvForTesting();
		mocks.getProjectById.mockResolvedValue(null);

		const models = await getProjectAvailableModels('project-1');
		expect(models.some(({ provider }) => provider === 'nao')).toBe(false);
		await expect(
			resolveProviderModel('project-1', 'nao', 'gpt-6-luna', true, {
				userId: 'user-1',
				category: 'chat',
			}),
		).resolves.toBeNull();
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
