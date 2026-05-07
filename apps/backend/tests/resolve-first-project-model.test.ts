import type { LlmProvider } from '@nao/shared/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Full factory mocks — avoid loading bun:sqlite or SDK packages
const mocks = vi.hoisted(() => ({
	getProjectLlmConfigs: vi.fn(),
	getProjectLlmConfigByProvider: vi.fn(),
	createProviderModel: vi.fn(),
	getDefaultModelId: vi.fn((provider: string) => `default-model-${provider}`),
	PROVIDER_META: {} as Record<string, unknown>,
	KNOWN_MODELS: {} as Record<string, unknown>,
}));

vi.mock('../src/queries/project-llm-config.queries', () => ({
	getProjectLlmConfigs: mocks.getProjectLlmConfigs,
	getProjectLlmConfigByProvider: mocks.getProjectLlmConfigByProvider,
}));

vi.mock('../src/agents/providers', () => ({
	createProviderModel: mocks.createProviderModel,
	getDefaultModelId: mocks.getDefaultModelId,
	PROVIDER_META: mocks.PROVIDER_META,
	KNOWN_MODELS: mocks.KNOWN_MODELS,
	LLM_PROVIDERS: {
		anthropic: {
			envVar: 'ANTHROPIC_API_KEY',
			auth: { apiKey: 'required' },
			extractorModelId: 'claude-haiku-4-5',
			models: [],
		},
		openai: {
			envVar: 'OPENAI_API_KEY',
			auth: { apiKey: 'required' },
			extractorModelId: 'gpt-4.1-mini',
			models: [],
		},
		google: {
			envVar: 'GEMINI_API_KEY',
			auth: { apiKey: 'required' },
			extractorModelId: 'gemini-2.5-flash',
			models: [],
		},
		mistral: {
			envVar: 'MISTRAL_API_KEY',
			auth: { apiKey: 'required' },
			extractorModelId: 'mistral-medium-latest',
			models: [],
		},
		openrouter: {
			envVar: 'OPENROUTER_API_KEY',
			auth: { apiKey: 'required' },
			extractorModelId: 'anthropic/claude-haiku-4.5',
			models: [],
		},
		ollama: { envVar: 'OLLAMA_API_KEY', auth: { apiKey: 'none' }, extractorModelId: 'llama3.2:3b', models: [] },
		bedrock: {
			envVar: 'AWS_BEARER_TOKEN_BEDROCK',
			auth: { apiKey: 'optional', alternativeEnvVars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] },
			extractorModelId: 'anthropic.claude-sonnet-4-6',
			models: [],
		},
		vertex: {
			envVar: 'VERTEX_GOOGLE_SERVICE_ACCOUNT_JSON',
			auth: { apiKey: 'none', extraFields: [{ envVar: 'GOOGLE_VERTEX_PROJECT' }] },
			extractorModelId: 'gemini-2.5-flash',
			models: [],
		},
		azure: { envVar: 'AZURE_API_KEY', auth: { apiKey: 'required' }, extractorModelId: '', models: [] },
	},
}));

const { resolveFirstProjectModel } = await import('../src/utils/llm');

const PROJECT_ID = 'test-project';

function makeDbConfig(provider: LlmProvider) {
	return { provider, projectId: PROJECT_ID, apiKey: 'test-key', enabledModels: [], baseUrl: null, credentials: null };
}

function makeModel() {
	return { model: {} as never, providerOptions: {}, contextWindow: 200_000 };
}

describe('resolveFirstProjectModel', () => {
	const savedEnv: Record<string, string | undefined> = {};
	const envKeys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'MISTRAL_API_KEY', 'OPENROUTER_API_KEY'];

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getProjectLlmConfigByProvider.mockResolvedValue(null);
		// snapshot and clear all provider env keys
		for (const key of envKeys) {
			savedEnv[key] = process.env[key];
			delete process.env[key];
		}
	});

	afterEach(() => {
		for (const key of envKeys) {
			if (savedEnv[key] === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = savedEnv[key];
			}
		}
	});

	it('returns null when no DB configs and no env providers configured', async () => {
		mocks.getProjectLlmConfigs.mockResolvedValue([]);

		const result = await resolveFirstProjectModel(PROJECT_ID, () => 'some-model');

		expect(result).toBeNull();
		expect(mocks.createProviderModel).not.toHaveBeenCalled();
	});

	it('resolves first DB-configured provider and returns model', async () => {
		mocks.getProjectLlmConfigs.mockResolvedValue([makeDbConfig('google'), makeDbConfig('mistral')]);
		mocks.getProjectLlmConfigByProvider.mockResolvedValue(makeDbConfig('google'));
		const fakeModel = makeModel();
		mocks.createProviderModel.mockReturnValue(fakeModel);

		const result = await resolveFirstProjectModel(PROJECT_ID, () => 'gemini-2.5-flash');

		expect(mocks.createProviderModel).toHaveBeenCalledWith('google', expect.anything(), 'gemini-2.5-flash');
		expect(result).toBe(fakeModel);
	});

	it('skips provider where selectModelId returns empty string (e.g. azure with no extractorModelId)', async () => {
		mocks.getProjectLlmConfigs.mockResolvedValue([makeDbConfig('azure'), makeDbConfig('anthropic')]);
		mocks.getProjectLlmConfigByProvider.mockResolvedValue(makeDbConfig('anthropic'));
		const fakeModel = makeModel();
		mocks.createProviderModel.mockReturnValue(fakeModel);

		const result = await resolveFirstProjectModel(PROJECT_ID, (provider) =>
			provider === 'azure' ? '' : 'claude-haiku-4-5',
		);

		expect(mocks.createProviderModel).toHaveBeenCalledTimes(1);
		expect(mocks.createProviderModel).toHaveBeenCalledWith('anthropic', expect.anything(), 'claude-haiku-4-5');
		expect(result).toBe(fakeModel);
	});

	it('skips DB provider that cannot be resolved and tries next', async () => {
		mocks.getProjectLlmConfigs.mockResolvedValue([makeDbConfig('ollama'), makeDbConfig('mistral')]);
		mocks.getProjectLlmConfigByProvider
			.mockResolvedValueOnce(null) // ollama has no DB config or env key
			.mockResolvedValueOnce(makeDbConfig('mistral'));
		const fakeModel = makeModel();
		mocks.createProviderModel.mockReturnValueOnce(fakeModel);

		const result = await resolveFirstProjectModel(PROJECT_ID, () => 'some-model');

		expect(mocks.createProviderModel).toHaveBeenCalledTimes(1);
		expect(mocks.createProviderModel).toHaveBeenCalledWith('mistral', expect.anything(), 'some-model');
		expect(result).toBe(fakeModel);
	});

	it('falls back to env-configured provider when DB has no configs', async () => {
		mocks.getProjectLlmConfigs.mockResolvedValue([]);
		process.env.GEMINI_API_KEY = 'env-google-key';
		const fakeModel = makeModel();
		mocks.createProviderModel.mockReturnValue(fakeModel);

		const result = await resolveFirstProjectModel(PROJECT_ID, () => 'gemini-2.5-flash');

		expect(mocks.createProviderModel).toHaveBeenCalledWith('google', expect.anything(), 'gemini-2.5-flash');
		expect(result).toBe(fakeModel);
	});

	it('does not retry env provider already in DB configs', async () => {
		// google is in DB (but fails), anthropic is only in env
		mocks.getProjectLlmConfigs.mockResolvedValue([makeDbConfig('google')]);
		process.env.GEMINI_API_KEY = 'env-key';
		process.env.ANTHROPIC_API_KEY = 'env-key-2';
		// google DB config lookup returns null, env key also present so createProviderModel called for google
		mocks.getProjectLlmConfigByProvider.mockResolvedValue(null);
		const fakeModel = makeModel();
		mocks.createProviderModel
			.mockReturnValueOnce(null) // google fails
			.mockReturnValueOnce(fakeModel); // anthropic (env-only) succeeds

		const result = await resolveFirstProjectModel(PROJECT_ID, () => 'some-model');

		const calledProviders = mocks.createProviderModel.mock.calls.map((c) => c[0] as string);
		// google tried once total (not twice), anthropic tried once
		expect(calledProviders.filter((p) => p === 'google')).toHaveLength(1);
		expect(result).toBe(fakeModel);
	});

	it('returns null when all DB and env providers fail to resolve', async () => {
		mocks.getProjectLlmConfigs.mockResolvedValue([makeDbConfig('bedrock')]);
		process.env.OPENAI_API_KEY = 'env-key';
		mocks.getProjectLlmConfigByProvider.mockResolvedValue(null);
		mocks.createProviderModel.mockReturnValue(null);

		const result = await resolveFirstProjectModel(PROJECT_ID, () => 'some-model');

		expect(result).toBeNull();
	});

	it('passes provider-specific modelId from selector to createProviderModel', async () => {
		mocks.getProjectLlmConfigs.mockResolvedValue([makeDbConfig('anthropic')]);
		mocks.getProjectLlmConfigByProvider.mockResolvedValue(makeDbConfig('anthropic'));
		mocks.createProviderModel.mockReturnValue(makeModel());

		await resolveFirstProjectModel(PROJECT_ID, (provider) =>
			provider === 'anthropic' ? 'claude-haiku-4-5' : 'gpt-4.1-mini',
		);

		expect(mocks.createProviderModel).toHaveBeenCalledWith('anthropic', expect.anything(), 'claude-haiku-4-5');
	});
});
