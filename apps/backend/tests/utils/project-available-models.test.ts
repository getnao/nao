import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { __reloadEnvForTesting } from '../../src/env';
import { getProjectAvailableModels, resolveContextWindow, resolveProviderModel } from '../../src/utils/llm';
import { useNaoConfigProjects } from '../helpers/nao-config-project';
import { restoreProcessEnvAfterEach } from '../helpers/process-env-snapshot';

const mocks = vi.hoisted(() => ({
	isCloud: false,
	getProjectById: vi.fn(),
	getProjectLlmConfigs: vi.fn(),
	getProjectLlmConfigByProvider: vi.fn(),
}));

vi.mock('../../src/env', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/env')>()),
	get isCloud() {
		return mocks.isCloud;
	},
}));

vi.mock('../../src/queries/project.queries', () => ({
	getProjectById: mocks.getProjectById,
}));

vi.mock('../../src/queries/project-llm-config.queries', () => ({
	getProjectLlmConfigs: mocks.getProjectLlmConfigs,
	getProjectLlmConfigByProvider: mocks.getProjectLlmConfigByProvider,
}));

vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));

const writeConfig = useNaoConfigProjects('nao-available-models-');

restoreProcessEnvAfterEach({ unset: ['OPENAI_API_KEY'], afterRestore: __reloadEnvForTesting });

function enableManagedAi(): void {
	process.env.NAO_MANAGED_OPENAI_API_KEY = 'managed-key';
	__reloadEnvForTesting();
}

describe('getProjectAvailableModels', () => {
	beforeEach(() => {
		process.env.NAO_MODE = 'cloud';
		process.env.CLOUD_GITHUB_PROJECT_ORG = 'test-org';
		process.env.CLOUD_GITHUB_PROJECT_APP_ID = '123';
		process.env.CLOUD_GITHUB_PROJECT_INSTALLATION_ID = '456';
		process.env.CLOUD_GITHUB_PROJECT_PRIVATE_KEY = 'test-private-key';
		process.env.SMTP_HOST = 'smtp.example.com';
		process.env.SMTP_MAIL_FROM = 'hello@example.com';
		process.env.SMTP_PASSWORD = 'secret';
		__reloadEnvForTesting();
		vi.clearAllMocks();
		mocks.getProjectLlmConfigs.mockResolvedValue([]);
	});

	it('keeps the curated nao models available after BYOK is configured', async () => {
		enableManagedAi();
		mocks.getProjectById.mockResolvedValue({ id: 'project-1', orgId: 'org-1', path: null, envVars: {} });

		const managed = await getProjectAvailableModels('project-1');
		expect(managed.map(({ provider, modelId }) => ({ provider, modelId }))).toEqual([
			{ provider: 'nao', modelId: 'gpt-6-luna' },
			{ provider: 'nao', modelId: 'gpt-6-sol' },
		]);
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

	it('keeps managed models available when the wallet has no credits', async () => {
		enableManagedAi();
		mocks.getProjectById.mockResolvedValue({ id: 'project-1', orgId: 'org-1', path: null, envVars: {} });

		const models = await getProjectAvailableModels('project-1');

		expect(models.filter(({ provider }) => provider === 'nao').map(({ modelId }) => modelId)).toEqual([
			'gpt-6-luna',
			'gpt-6-sol',
		]);
	});

	it('offers managed models when an environment provider has no selectable model', async () => {
		enableManagedAi();
		process.env.OPENAI_COMPATIBLE_BASE_URL = 'http://localhost:8000/v1';
		mocks.getProjectById.mockResolvedValue({ id: 'project-1', orgId: 'org-1', path: null, envVars: {} });

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

	it('gives a model the context window nao_config.yaml declares for it, over the one nao knows', async () => {
		const dir = writeConfig([
			'llm:',
			'  providers:',
			'  - provider: openai',
			'    api_key: sk-openai',
			'    models:',
			'    - id: acsw@azure/gpt-6-sol',
			'      context_window: 1050000',
			'    - id: gpt-6-sol',
			'      context_window: 400000',
			'    - id: gpt-6-luna',
			'    - id: acsw@azure/unlisted',
		]);
		mocks.getProjectById.mockResolvedValue({ path: dir, envVars: {} });

		const windows: Record<string, number | undefined> = {};
		for (const modelId of ['acsw@azure/gpt-6-sol', 'gpt-6-sol', 'gpt-6-luna', 'acsw@azure/unlisted']) {
			const resolved = await resolveProviderModel('project-1', 'openai', modelId);
			expect(await resolveContextWindow('project-1', 'openai', modelId)).toBe(resolved?.contextWindow);
			windows[modelId] = resolved?.contextWindow;
		}

		expect(windows).toEqual({
			'acsw@azure/gpt-6-sol': 1_050_000,
			'gpt-6-sol': 400_000,
			'gpt-6-luna': 1_050_000,
			'acsw@azure/unlisted': 200_000,
		});
	});
});

describe('resolveProviderModel with a project base URL pointing at a private address', () => {
	const captured: { url?: string; authorization?: string }[] = [];
	const captureServer = http.createServer((request, response) => {
		captured.push({ url: request.url, authorization: request.headers.authorization });
		response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(chatCompletion()));
	});

	beforeAll(() => new Promise<void>((resolve) => captureServer.listen(0, '127.0.0.1', resolve)));
	afterAll(() => new Promise<void>((resolve) => captureServer.close(() => resolve())));

	beforeEach(() => {
		captured.length = 0;
		mocks.getProjectById.mockResolvedValue(null);
		mocks.getProjectLlmConfigByProvider.mockResolvedValue({
			provider: 'openaiCompatible',
			apiKey: 'canary-key',
			baseUrl: `http://127.0.0.1:${(captureServer.address() as AddressInfo).port}/v1`,
			enabledModels: ['internal-model'],
			customModels: [{ id: 'internal-model' }],
			modelSettings: {},
			credentials: null,
		});
		return () => {
			mocks.isCloud = false;
			mocks.getProjectLlmConfigByProvider.mockReset();
		};
	});

	it('is refused on cloud before any request leaves the server', async () => {
		mocks.isCloud = true;

		await expect(generateWithProjectModel()).rejects.toThrow('private address');
		expect(captured).toEqual([]);
	});

	it('is reached on a self-hosted instance, where internal endpoints are the point', async () => {
		await generateWithProjectModel();

		expect(captured).toEqual([{ url: '/v1/chat/completions', authorization: 'Bearer canary-key' }]);
	});

	async function generateWithProjectModel() {
		const resolved = await resolveProviderModel('project-1', 'openaiCompatible', 'internal-model');
		return resolved!.model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] });
	}

	function chatCompletion() {
		return {
			id: 'chatcmpl-1',
			object: 'chat.completion',
			created: 0,
			model: 'internal-model',
			choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		};
	}
});
